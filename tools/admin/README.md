# Patchwork admin

A control panel for the classroom relay that runs **on your own computer**, not on the site.
The relay has no admin pages or admin API.

```
python admin.py          # opens http://127.0.0.1:8766 in your browser
python admin.py --demo   # sample data, no token needed
```

On Windows, double-click **start-admin.bat**. Python 3.9+, standard library only.

| Tab | |
|---|---|
| **Overview** | classes taught, people, who's connected now, oldest record (shows if the 90-day clean-up stopped). **Setup check**: relay answering, log tables present (with a *Create tables* button, so no D1 console), and the Worker's `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS`, `DB`, `CLASSROOM` and cron |
| **Sessions** | recent classes; click one for who joined and when; export CSV |
| **Look up** | everything one Google account taught or joined; export CSV/JSON (for a lawful or preservation request) |
| **SQL** | read-only query box |
| **Settings** | Cloudflare account ID, API token, D1 database ID, relay address |

## Setup (once)

- **Cloudflare account ID**: dashboard → Workers & Pages, right-hand column.
- **API token**: My Profile → API Tokens → Create Token → *Custom token*:
  `Account › D1 › Edit` and `Account › Workers Scripts › Read`, limited to your account.
- **D1 database ID**: Storage & Databases → D1 → `patchwork-classroom`.
- **Relay address**: `https://patchwork-classroom.<you>.workers.dev`.

## Where the token lives

In `~/.patchwork-admin.json` (your home folder, outside the repo), readable only by you. The
browser page never receives it. The local server listens on `127.0.0.1` only, rejects foreign
`Host` headers, sends no CORS headers, and needs a per-run session value only its own page knows.

Nothing here changes or deletes log records. The only write is *Create tables*, which runs
`relay/schema.sql` (`CREATE ... IF NOT EXISTS` only).

## Tests

`python test_admin.py`
