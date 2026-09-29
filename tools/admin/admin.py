#!/usr/bin/env python3
"""
Patchwork admin: a local control panel for the classroom relay.

Runs on your own computer, not on the site. Talks to:
  - Cloudflare D1   (the connection log) through Cloudflare's REST API
  - Cloudflare      (the Worker's bindings and cron, read-only) through the same API
  - the relay       (/api/config) to confirm it's up and configured

The dashboard opens at http://127.0.0.1:<port>. The API token lives only in
~/.patchwork-admin.json and in this process; the browser page never receives it.

Standard library only. Python 3.9+.

    python admin.py            normal
    python admin.py --demo     sample data, no token needed
    python admin.py --port N   pick the port (default 8766)
"""

import argparse
import datetime as dt
import json
import os
import re
import secrets
import sqlite3
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_PATH = HERE.parent.parent / 'relay' / 'schema.sql'
CONFIG_PATH = Path.home() / '.patchwork-admin.json'
UA = 'patchwork-admin/1.0'
DAY_MS = 24 * 3600 * 1000
RETENTION_DAYS = 90

DEFAULTS = {
    'cf_account_id': '',
    'cf_api_token': '',
    'd1_database_id': '',
    'worker_name': 'patchwork-classroom',
    'relay_url': '',
    'origin': 'https://forkmytypos.github.io',
}
SECRET_KEYS = ('cf_api_token',)


class AdminError(Exception):
    """An error whose message is fit to show in the dashboard."""
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def now_ms():
    return int(time.time() * 1000)


# ── config: ~/.patchwork-admin.json, readable only by you ──

def load_config():
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text('utf-8')))
        except (ValueError, OSError) as e:
            print(f'! could not read {CONFIG_PATH}: {e}', file=sys.stderr)
    return cfg


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), 'utf-8')
    try:
        os.chmod(CONFIG_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def public_config(cfg):
    out = {k: v for k, v in cfg.items() if k not in SECRET_KEYS}
    for k in SECRET_KEYS:
        out[k + '_set'] = bool(cfg.get(k))
    return out


# ── HTTP ──

def http_json(method, url, token=None, body=None, headers=None, timeout=30):
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, (json.loads(raw) if raw else {})
            except ValueError:
                return r.status, {'text': raw[:200].decode('utf-8', 'replace')}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, (json.loads(raw) if raw else {})
        except ValueError:
            return e.code, {'text': raw[:200].decode('utf-8', 'replace')}
    except urllib.error.URLError as e:
        raise AdminError(f'could not reach {url.split("/")[2]}: {e.reason}', 502)


# ── database backends: D1 over REST, or local SQLite for demo + tests ──

class D1Rest:
    def __init__(self, cfg):
        if not (cfg.get('cf_account_id') and cfg.get('d1_database_id') and cfg.get('cf_api_token')):
            raise AdminError('Cloudflare isn’t set up yet: open Settings', 409)
        self.url = (f"https://api.cloudflare.com/client/v4/accounts/{cfg['cf_account_id']}"
                    f"/d1/database/{cfg['d1_database_id']}/query")
        self.token = cfg['cf_api_token']

    def query(self, sql, params=()):
        status, j = http_json('POST', self.url, self.token, {'sql': sql, 'params': list(params)})
        if status != 200 or not j.get('success'):
            errs = '; '.join(e.get('message', '?') for e in j.get('errors', [])) or f'HTTP {status}'
            if status in (401, 403):
                raise AdminError(f'Cloudflare refused the token ({errs}). It needs Account › D1 › Edit.', 403)
            raise AdminError(f'D1: {errs}', 502)
        return (j.get('result') or [{}])[0].get('results') or []


class SqliteDB:
    """Local stand-in with D1's semantics (D1 is SQLite). Used by --demo and tests."""
    def __init__(self):
        self.conn = sqlite3.connect(':memory:', check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()

    def query(self, sql, params=()):
        p = list(params)
        # ?1-style placeholders bind by name; a plain list is deprecated for them
        bind = {str(i + 1): v for i, v in enumerate(p)} if re.search(r'\?\d', sql) else p
        with self.lock:
            cur = self.conn.execute(sql, bind)
            out = [dict(r) for r in cur.fetchall()]
            self.conn.commit()
            return out


def one(db, sql, *params):
    r = db.query(sql, params)
    return r[0] if r else None


def schema_statements():
    """relay/schema.sql as single statements, block comments removed. Only CREATE ... IF NOT EXISTS."""
    text = re.sub(r'/\*.*?\*/', '', SCHEMA_PATH.read_text('utf-8'), flags=re.S)
    out = [s.strip() for s in text.split(';') if s.strip()]
    for s in out:
        if not re.match(r'CREATE (TABLE|INDEX) IF NOT EXISTS ', s):
            raise AdminError('schema.sql has a statement that isn’t CREATE ... IF NOT EXISTS; refusing to run it', 500)
    return out


# ── reads ──

TABLES = ('sessions', 'participants')


def tables_present(db):
    names = {r['name'] for r in db.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    return {t: t in names for t in TABLES}


def overview(db):
    present = tables_present(db)
    if not all(present.values()):
        return {'tables': present}
    n = now_ms()
    s = one(db, """SELECT COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN started_at > ?1 THEN 1 ELSE 0 END), 0) AS day,
               COALESCE(SUM(CASE WHEN started_at > ?2 THEN 1 ELSE 0 END), 0) AS week,
               MIN(started_at) AS oldest FROM sessions""", n - DAY_MS, n - 7 * DAY_MS)
    p = one(db, """SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS people,
               COALESCE(SUM(CASE WHEN left_at IS NULL AND joined_at > ?1 THEN 1 ELSE 0 END), 0) AS open,
               COUNT(DISTINCT CASE WHEN joined_at > ?2 THEN user_id END) AS people7,
               MIN(joined_at) AS oldest FROM participants""", n - DAY_MS, n - 7 * DAY_MS)
    oldest = min([x for x in (s['oldest'], p['oldest']) if x is not None], default=None)
    return {'tables': present, 'sessions': s, 'participants': p, 'oldest': oldest,
            'retention_days': RETENTION_DAYS, 'now': n}


def sessions(db, limit=100):
    limit = max(1, min(int(limit or 100), 500))
    return db.query("""SELECT s.id, s.teacher_id, s.started_at, s.ended_at,
               COALESCE(SUM(CASE WHEN p.role != 'teacher' THEN 1 ELSE 0 END), 0) AS joins,
               COUNT(DISTINCT CASE WHEN p.role != 'teacher' THEN p.user_id END) AS students
          FROM sessions s LEFT JOIN participants p ON p.session_id = s.id
         GROUP BY s.id ORDER BY s.started_at DESC LIMIT ?1""", (limit,))


SESSION_RE = re.compile(r'^[0-9a-fA-F-]{8,64}$')


def session_detail(db, sid):
    if not SESSION_RE.match(sid or ''):
        raise AdminError('Invalid session id')
    s = one(db, 'SELECT id, teacher_id, started_at, ended_at FROM sessions WHERE id = ?1', sid)
    if not s:
        raise AdminError('No such session (it may be older than 90 days)', 404)
    s['participants'] = db.query("""SELECT user_id, role, joined_at, left_at FROM participants
                                    WHERE session_id = ?1 ORDER BY joined_at""", (sid,))
    return s


GOOGLE_ID_RE = re.compile(r'^[0-9A-Za-z._:-]{1,128}$')    # Google "sub" is digits; dev ids allowed for tests


def lookup(db, uid):
    uid = (uid or '').strip()
    if not GOOGLE_ID_RE.match(uid):
        raise AdminError('Enter a Google account ID (the long number)')
    return {
        'user_id': uid,
        'taught': db.query("""SELECT id, started_at, ended_at FROM sessions
                              WHERE teacher_id = ?1 ORDER BY started_at""", (uid,)),
        'joined': db.query("""SELECT p.session_id, s.teacher_id, p.role, p.joined_at, p.left_at
                                FROM participants p LEFT JOIN sessions s ON s.id = p.session_id
                               WHERE p.user_id = ?1 ORDER BY p.joined_at""", (uid,)),
        'exported_at': now_ms(),
    }


# a read-only query box: an accident guard, not a security boundary
READ_ONLY = re.compile(r'^\s*(select|with|pragma|explain)\b', re.I)
WRITES = re.compile(r'\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b', re.I)


def sql_console(db, sql):
    sql = (sql or '').strip().rstrip(';')
    if not sql:
        raise AdminError('Type a query')
    if ';' in sql:
        raise AdminError('One statement at a time')
    if not READ_ONLY.match(sql) or WRITES.search(sql):
        raise AdminError('Read-only here: SELECT, WITH, PRAGMA or EXPLAIN.')
    t = time.time()
    r = db.query(sql)
    return {'rows': r[:1000], 'count': len(r), 'truncated': len(r) > 1000, 'ms': round((time.time() - t) * 1000)}


def create_tables(db):
    stmts = schema_statements()
    for s in stmts:
        db.query(s)
    return {'ok': True, 'statements': len(stmts), 'tables': tables_present(db)}


# ── setup check: relay answering + Worker bindings/cron (read-only) ──

EXPECTED = [
    ('var', 'GOOGLE_CLIENT_ID'), ('var', 'ALLOWED_ORIGINS'),
    ('d1', 'DB'), ('durable_object_namespace', 'CLASSROOM'),
]


def relay_health(cfg):
    base = (cfg.get('relay_url') or '').strip().rstrip('/')
    if not base:
        return {'reachable': False, 'error': 'Set the relay address in Settings'}
    try:
        status, j = http_json('GET', base + '/api/config', headers={'Origin': cfg.get('origin') or ''}, timeout=10)
    except AdminError as e:
        return {'reachable': False, 'error': str(e)}
    if status == 403:
        return {'reachable': True, 'ok': False, 'error': 'The relay refused this origin: check ALLOWED_ORIGINS'}
    if 'googleClientId' not in j:
        return {'reachable': False, 'error': f'HTTP {status}: not the Patchwork relay answering'}
    return {'reachable': True, 'ok': bool(j['googleClientId']), 'googleClientId': j['googleClientId'],
            'error': '' if j['googleClientId'] else 'GOOGLE_CLIENT_ID is empty'}


def _cf(cfg, path):
    if not (cfg.get('cf_account_id') and cfg.get('cf_api_token')):
        raise AdminError('Cloudflare isn’t set up yet: open Settings', 409)
    url = f"https://api.cloudflare.com/client/v4/accounts/{cfg['cf_account_id']}{path}"
    status, j = http_json('GET', url, cfg['cf_api_token'])
    if status >= 400 or not j.get('success', False):
        errs = '; '.join(e.get('message', '?') for e in j.get('errors', [])) or f'HTTP {status}'
        if status in (401, 403):
            raise AdminError(f'Cloudflare refused this ({errs}). The token needs Account › Workers Scripts › Read.', 403)
        raise AdminError(f'Cloudflare: {errs}', 502)
    return j.get('result')


def worker_check(cfg):
    name = urllib.parse.quote(cfg.get('worker_name') or '', safe='')
    settings = _cf(cfg, f'/workers/scripts/{name}/settings') or {}
    have = {(b.get('type'), b.get('name')) for b in settings.get('bindings') or []}
    # plain_text and secret_text both count as a variable
    have |= {('var', n) for t, n in have if t in ('plain_text', 'secret_text')}
    out = [{'what': n, 'kind': k, 'ok': (k, n) in have} for k, n in EXPECTED]
    try:
        crons = [s.get('cron') for s in (_cf(cfg, f'/workers/scripts/{name}/schedules') or {}).get('schedules') or []]
    except AdminError:
        crons = None
    out.append({'what': 'daily clean-up (cron)', 'kind': 'cron', 'ok': bool(crons), 'detail': ', '.join(crons or [])})
    db_id = next((b.get('id') for b in settings.get('bindings') or [] if b.get('type') == 'd1' and b.get('name') == 'DB'), None)
    if db_id and cfg.get('d1_database_id') and db_id != cfg['d1_database_id']:
        out.append({'what': 'DB points at the database in Settings', 'kind': 'd1', 'ok': False,
                    'detail': f'Worker uses {db_id[:8]}…'})
    return out


# ── the local web server ──
#  Listens on 127.0.0.1 only; Host header must be itself (DNS rebinding); every
#  /api call needs the per-run X-Session value that only its own page knows; no CORS.

class App:
    def __init__(self, port, demo_db=None):
        self.port = port
        self.session = secrets.token_urlsafe(24)
        self.demo = demo_db is not None
        self.demo_db = demo_db
        self.cfg = dict(DEFAULTS) if self.demo else load_config()

    def db(self):
        return self.demo_db if self.demo else D1Rest(self.cfg)

    def allowed_hosts(self):
        return {f'127.0.0.1:{self.port}', f'localhost:{self.port}'}


def _settings(app, cfg, q, body):
    if app.demo:
        raise AdminError('Settings aren’t saved in demo mode', 409)
    for k in DEFAULTS:
        if k in body and not (k in SECRET_KEYS and not body[k]):    # blank secret = keep the saved one
            cfg[k] = str(body[k]).strip()
    save_config(cfg)
    return public_config(cfg)


def _demo_block(app):
    if app.demo:
        raise AdminError('Not available in demo mode', 409)


ROUTES = {
    ('GET', '/api/status'): lambda app, cfg, q, b: {
        'demo': app.demo, 'config': public_config(cfg), 'config_path': str(CONFIG_PATH),
        'ready': app.demo or bool(cfg.get('cf_account_id') and cfg.get('cf_api_token') and cfg.get('d1_database_id'))},
    ('POST', '/api/settings'): _settings,
    ('GET', '/api/overview'): lambda app, cfg, q, b: overview(app.db()),
    ('GET', '/api/sessions'): lambda app, cfg, q, b: sessions(app.db(), q.get('limit')),
    ('GET', '/api/session'): lambda app, cfg, q, b: session_detail(app.db(), q.get('id', '')),
    ('GET', '/api/lookup'): lambda app, cfg, q, b: lookup(app.db(), q.get('id', '')),
    ('POST', '/api/sql'): lambda app, cfg, q, b: sql_console(app.db(), b.get('sql')),
    ('POST', '/api/create-tables'): lambda app, cfg, q, b: create_tables(app.db()),
    ('GET', '/api/relay'): lambda app, cfg, q, b: (
        {'reachable': True, 'ok': True, 'googleClientId': 'demo.apps.googleusercontent.com'} if app.demo else relay_health(cfg)),
    ('GET', '/api/worker'): lambda app, cfg, q, b: _demo_block(app) or worker_check(cfg),
}


def make_handler(app):
    page = (HERE / 'admin.html').read_text('utf-8')

    class Handler(BaseHTTPRequestHandler):
        server_version = 'patchwork-admin'

        def log_message(self, fmt, *args):
            pass

        def send(self, status, body, ctype='application/json; charset=utf-8', extra=None):
            data = body if isinstance(body, bytes) else json.dumps(body, default=str).encode()
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def fail(self, status, msg):
            self.send(status, {'error': msg})

        def guard(self, api):
            if self.headers.get('Host', '') not in app.allowed_hosts():
                self.fail(403, 'wrong host')
                return False
            if api and not secrets.compare_digest(self.headers.get('X-Session', ''), app.session):
                self.fail(403, 'missing or wrong session')
                return False
            return True

        def do_OPTIONS(self):
            self.fail(405, 'no')

        def do_GET(self):
            path, _, qs = self.path.partition('?')
            if path in ('/', '/index.html'):
                if not self.guard(False):
                    return
                nonce = secrets.token_urlsafe(16)
                html = (page.replace('%%SESSION%%', app.session)
                            .replace('%%DEMO%%', 'true' if app.demo else 'false')
                            .replace('<script>', f'<script nonce="{nonce}">'))
                self.send(200, html.encode(), 'text/html; charset=utf-8', {
                    'Content-Security-Policy': '; '.join([
                        "default-src 'none'", f"script-src 'nonce-{nonce}'", "style-src 'unsafe-inline'",
                        "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]),
                    'Referrer-Policy': 'no-referrer'})
                return
            if not path.startswith('/api/'):
                return self.fail(404, 'not found')
            if self.guard(True):
                self.dispatch('GET', path, dict(urllib.parse.parse_qsl(qs)), None)

        def do_POST(self):
            path = self.path.partition('?')[0]
            if not self.guard(True):
                return
            n = int(self.headers.get('Content-Length') or 0)
            if n > 100_000:
                return self.fail(413, 'request too large')
            try:
                body = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                return self.fail(400, 'bad JSON')
            self.dispatch('POST', path, {}, body if isinstance(body, dict) else {})

        def dispatch(self, method, path, q, body):
            try:
                r = ROUTES.get((method, path))
                if not r:
                    return self.fail(404, 'not found')
                self.send(200, r(app, app.cfg, q, body))
            except AdminError as e:
                self.fail(e.status, str(e))
            except Exception as e:
                print(f'! {method} {path}: {e!r}', file=sys.stderr)
                self.fail(500, f'Unexpected error: {e}')

    return Handler


# ── demo data: the real schema, a plausible fortnight ──

def demo_db():
    import random
    rnd = random.Random(7)
    db = SqliteDB()
    create_tables(db)
    teachers = [str(rnd.randrange(10 ** 20, 10 ** 21)) for _ in range(2)]
    students = [str(rnd.randrange(10 ** 20, 10 ** 21)) for _ in range(14)]
    n = now_ms()
    for i in range(12):
        sid = '%08x-%04x-4%03x-a%03x-%012x' % (rnd.getrandbits(32), rnd.getrandbits(16), rnd.getrandbits(12),
                                               rnd.getrandbits(12), rnd.getrandbits(48))
        start = n - rnd.randint(0, 14) * DAY_MS - rnd.randint(1, 8) * 3600_000
        live = i == 0
        if live:
            start = n - 20 * 60_000
        end = None if live else start + rnd.randint(40, 70) * 60_000
        t = teachers[i % 2]
        db.query('INSERT INTO sessions VALUES (?, ?, ?, ?)', (sid, t, start, end))
        db.query("INSERT INTO participants (session_id, user_id, role, joined_at, left_at) VALUES (?, ?, 'teacher', ?, ?)",
                 (sid, t, start, end))
        for s in rnd.sample(students, rnd.randint(4, 10)):
            j = start + rnd.randint(0, 5) * 60_000
            db.query("INSERT INTO participants (session_id, user_id, role, joined_at, left_at) VALUES (?, ?, 'student', ?, ?)",
                     (sid, s, j, None if live else j + rnd.randint(20, 40) * 60_000))
    return db


def main():
    ap = argparse.ArgumentParser(description='Patchwork admin: local control panel for the classroom relay')
    ap.add_argument('--port', type=int, default=8766)
    ap.add_argument('--demo', action='store_true', help='sample data, no token needed')
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()
    app = App(args.port, demo_db() if args.demo else None)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(app))
    except OSError as e:
        sys.exit(f'Could not start on port {args.port} ({e}). Already running? Try --port 8767')
    url = f'http://127.0.0.1:{args.port}/'
    print(f'Patchwork admin{" (DEMO)" if app.demo else ""} → {url}')
    if not app.demo and not CONFIG_PATH.exists():
        print('First run: the Settings tab will ask for your Cloudflare details.')
    print('Ctrl+C to stop.')
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped.')


if __name__ == '__main__':
    main()
