"""Tests for admin.py. Run: python test_admin.py"""
import json, sys, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import admin as A

PASS = FAIL = 0
def t(name, fn):
    global PASS, FAIL
    try: fn(); PASS += 1; print('  ok  ', name)
    except Exception as e: FAIL += 1; print('  FAIL', name, '::', repr(e))

db = A.demo_db()

def schema():
    s = A.schema_statements()
    assert len(s) == 6 and all(x.startswith('CREATE') for x in s), s
    assert A.create_tables(db)['tables'] == {'sessions': True, 'participants': True}   # idempotent
t('schema.sql: 6 CREATE IF NOT EXISTS statements, safe to run twice', schema)

def empty_db():
    e = A.SqliteDB()
    assert A.overview(e) == {'tables': {'sessions': False, 'participants': False}}
    A.create_tables(e)
    o = A.overview(e)
    assert o['sessions']['total'] == 0 and o['oldest'] is None
t('overview: reports missing tables, then works on an empty log', empty_db)

def overview():
    o = A.overview(db)
    assert o['sessions']['total'] == 12 and o['participants']['open'] > 0, o
    assert 0 < A.now_ms() - o['oldest'] < 16 * A.DAY_MS
t('overview: counts, open connections, oldest record', overview)

def sessions_and_detail():
    s = A.sessions(db)
    assert len(s) == 12 and s == sorted(s, key=lambda r: -r['started_at'])
    d = A.session_detail(db, s[0]['id'])
    assert d['participants'][0]['role'] == 'teacher' and len(d['participants']) == s[0]['joins'] + 1
    for bad in ('', "x' OR 1=1 --", 'a' * 80):
        try: A.session_detail(db, bad); raise AssertionError('accepted ' + bad)
        except A.AdminError: pass
t('sessions: newest first; detail lists everyone; bad ids refused', sessions_and_detail)

def lookup():
    teacher = A.sessions(db)[0]['teacher_id']
    r = A.lookup(db, teacher)
    assert r['taught'] and all(j['role'] == 'teacher' for j in r['joined'])
    student = A.one(db, "SELECT user_id FROM participants WHERE role = 'student'")['user_id']
    r = A.lookup(db, student)
    assert not r['taught'] and r['joined'] and all(j['teacher_id'] for j in r['joined'])
    assert A.lookup(db, '999')['joined'] == []
    for bad in ('', "1' OR '1'='1", 'a b'):
        try: A.lookup(db, bad); raise AssertionError('accepted ' + bad)
        except A.AdminError: pass
t('lookup: taught vs joined, unknown id empty, bad input refused', lookup)

def sql_guard():
    assert A.sql_console(db, 'SELECT COUNT(*) AS n FROM sessions')['rows'][0]['n'] == 12
    for bad in ('DELETE FROM sessions', 'SELECT 1; DROP TABLE sessions', 'WITH x AS (SELECT 1) DELETE FROM sessions', 'UPDATE participants SET role=1'):
        try: A.sql_console(db, bad); raise AssertionError('accepted: ' + bad)
        except A.AdminError: pass
    assert A.sql_console(db, 'SELECT COUNT(*) AS n FROM sessions')['rows'][0]['n'] == 12
t('SQL box: reads work, writes and stacked statements refused', sql_guard)

def worker_check():
    real = A._cf
    cfg = dict(A.DEFAULTS, cf_account_id='a', cf_api_token='t', d1_database_id='db1')
    A._cf = lambda c, p: ({'schedules': [{'cron': '17 3 * * *'}]} if p.endswith('/schedules') else
        {'bindings': [{'type': 'plain_text', 'name': 'GOOGLE_CLIENT_ID'}, {'type': 'plain_text', 'name': 'ALLOWED_ORIGINS'},
                      {'type': 'd1', 'name': 'DB', 'id': 'db1'}, {'type': 'durable_object_namespace', 'name': 'CLASSROOM'}]})
    try:
        r = A.worker_check(cfg)
        assert all(x['ok'] for x in r) and len(r) == 5, r
        A._cf = lambda c, p: ({'schedules': []} if p.endswith('/schedules') else
            {'bindings': [{'type': 'secret_text', 'name': 'GOOGLE_CLIENT_ID'}, {'type': 'd1', 'name': 'DB', 'id': 'other'}]})
        r = {x['what']: x['ok'] for x in A.worker_check(cfg)}
        assert r['GOOGLE_CLIENT_ID'] and not r['ALLOWED_ORIGINS'] and not r['CLASSROOM'] and not r['daily clean-up (cron)']
        assert r['DB points at the database in Settings'] is False
    finally:
        A._cf = real
t('worker check: all bindings + cron found; missing ones and wrong DB flagged', worker_check)

# a fake relay for the health check
class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        ok = self.path == '/api/config' and self.headers.get('Origin') == 'https://forkmytypos.github.io'
        body = json.dumps({'googleClientId': 'x.apps.googleusercontent.com'}).encode() if ok else b'origin not allowed'
        self.send_response(200 if ok else 403); self.end_headers(); self.wfile.write(body)
fake = ThreadingHTTPServer(('127.0.0.1', 18790), Fake)
threading.Thread(target=fake.serve_forever, daemon=True).start()

def relay():
    cfg = dict(A.DEFAULTS, relay_url='http://127.0.0.1:18790/')
    r = A.relay_health(cfg); assert r['reachable'] and r['ok'], r
    r = A.relay_health(dict(cfg, origin='https://evil.example')); assert not r['ok'] and 'ALLOWED_ORIGINS' in r['error'], r
    assert not A.relay_health(dict(A.DEFAULTS))['reachable']
    assert not A.relay_health(dict(A.DEFAULTS, relay_url='http://127.0.0.1:1'))['reachable']
t('relay health: config answered, wrong origin and unreachable reported', relay)
fake.shutdown()

# the local server's defences
PORT = 18766
app = A.App(PORT, A.demo_db())
srv = ThreadingHTTPServer(('127.0.0.1', PORT), A.make_handler(app))
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.3)

def req(path, host=f'127.0.0.1:{PORT}', session=None, method='GET', body=None):
    h = {'Host': host}
    if session: h['X-Session'] = session
    r = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', method=method, headers=h,
                               data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r) as x: return x.status, x.read(), dict(x.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)

def page():
    s, body, h = req('/')
    html = body.decode()
    assert s == 200 and app.session in html and '%%' not in html
    nonce = h['Content-Security-Policy'].split("'nonce-")[1].split("'")[0]
    assert f'<script nonce="{nonce}">' in html and '<script>' not in html and 'Access-Control-Allow-Origin' not in h
t('server: page gets the session + a CSP nonce, no CORS', page)

def guards():
    assert req('/', host='evil.example.com')[0] == 403
    assert req('/api/overview', host=f'evil.example.com:{PORT}', session=app.session)[0] == 403
    assert req('/api/overview')[0] == 403 and req('/api/overview', session='wrong')[0] == 403
    assert req('/api/overview', session=app.session, method='OPTIONS')[0] == 405
    s, body, _ = req('/api/overview', session=app.session)
    assert s == 200 and json.loads(body)['sessions']['total'] == 12
t('server: foreign Host, missing session and preflight refused', guards)

def no_token_leak():
    app.cfg['cf_api_token'] = 'SUPERSECRET-cf-token'
    s, body, _ = req('/api/status', session=app.session)
    assert b'SUPERSECRET' not in body and json.loads(body)['config']['cf_api_token_set'] is True
t('server: /api/status never returns the token', no_token_leak)

def demo_blocks():
    assert req('/api/settings', session=app.session, method='POST', body={'worker_name': 'x'})[0] == 409
    assert req('/api/worker', session=app.session)[0] == 409
t('server: settings and Cloudflare calls off in demo mode', demo_blocks)

srv.shutdown()
print(f'\n{PASS} passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
