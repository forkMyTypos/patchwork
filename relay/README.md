# Patchwork classroom relay (teaching mode)

A small Cloudflare Worker for **sign-in and connection set-up only** (WebRTC signalling). The classroom itself (the
teacher's broadcast and students' hand-ins) travels directly between browsers over WebRTC data channels and never passes
through Cloudflare. There is no TURN relay: if a network blocks direct connections, that participant can't connect
(the Classroom panel says so). Participants can see each other's IP addresses because the connection is direct. Teaching mode requires Google sign-in, and the relay keeps a minimal connection
log in Cloudflare D1: **Google account ID + join/leave times** per teaching session (no IP addresses, names, emails
or content). Records older than 90 days are deleted automatically every day.

## Deploy (about 20 minutes, free plans are enough)

You need a Cloudflare account (https://dash.cloudflare.com/sign-up), a Google account, and Node.js 18+
(https://nodejs.org, check with `node -v`).

### 1. Google sign-in client

1. Open https://console.cloud.google.com/ and create a project (e.g. "Patchwork").
2. **APIs & Services > OAuth consent screen**: choose *External*, fill in the app name, support email and developer
   email, and add your privacy policy link. Scopes: the default `openid`, `email`, `profile` are enough. Publish the app.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**: type *Web application*.
   Under **Authorized JavaScript origins** add `https://forkmytypos.github.io` (and `http://localhost:8765` if you
   test locally). No redirect URI is needed.
4. Copy the **Client ID** (`....apps.googleusercontent.com`).

### 2. Cloudflare

```sh
git clone https://github.com/forkMyTypos/patchwork
cd patchwork/relay
npx wrangler login                          # approve in the browser
npx wrangler d1 create patchwork-classroom  # prints a database_id
```

Edit `wrangler.toml`:

- `GOOGLE_CLIENT_ID` = the Client ID from step 1.4
- `database_id` = the id printed by `d1 create`
- `ALLOWED_ORIGINS` = where Patchwork is served (already `https://forkmytypos.github.io`)

Then create the tables and deploy:

```sh
npx wrangler d1 execute patchwork-classroom --remote --file=schema.sql
npx wrangler deploy
```

Deploy prints an address like `https://patchwork-classroom.<you>.workers.dev`. Opening it should show
`Patchwork classroom relay`.

### 3. Use it

In Patchwork: click the logo, then **Classroom**, and paste the address into "Classroom server". Sign in with Google,
then create or join a classroom. Teacher and students all use the same server address.

## Responding to a lawful request

Records are keyed by Google account ID (the stable "sub" Google issues; Google can link it to an account under their
own legal process). Examples:

```sh
# all sessions a user took part in
npx wrangler d1 execute patchwork-classroom --remote --command \
  "SELECT s.id, s.teacher_id, datetime(s.started_at/1000,'unixepoch') AS started, p.role,
          datetime(p.joined_at/1000,'unixepoch') AS joined, datetime(p.left_at/1000,'unixepoch') AS left
   FROM participants p JOIN sessions s ON s.id=p.session_id WHERE p.user_id='GOOGLE_ID' ORDER BY p.joined_at"

# everyone in one session
npx wrangler d1 execute patchwork-classroom --remote --command \
  "SELECT user_id, role, datetime(joined_at/1000,'unixepoch') AS joined, datetime(left_at/1000,'unixepoch') AS left
   FROM participants WHERE session_id='SESSION_ID' ORDER BY joined_at"
```

Records disappear after 90 days; if you receive a preservation request, export the relevant rows before then.

## Maintenance

- Update: `npx wrangler deploy` again. Live logs: `npx wrangler tail`. Remove: `npx wrangler delete`.
- The daily clean-up runs at 03:17 UTC (`[triggers]` in `wrangler.toml`).

## Local testing without Cloudflare or Google

```sh
cd relay && npm i ws && node dev-server.mjs 8787
```

Use `http://localhost:8787` as the classroom server. The dev server simulates Google sign-in ("Dev sign-in") and keeps
the connection log in memory (`GET /dev/log`). The Cloudflare Worker never accepts dev sign-ins.

## What the relay enforces

- Google sign-in (ID token verified against Google's keys, audience = your client ID) to create or join.
- Random 10-character join codes; the teacher's role is proven by a 256-bit secret, never taken from the client.
- Only well-formed WebRTC set-up messages (offer/answer/ICE candidate, rebuilt field by field, max 32 KB) are passed,
  and only between the teacher and one student; students can't reach each other. Signalling is rate-limited.
- Hand-ins go straight to the teacher's browser, which enforces the rules (pdf, png/jpg/gif/webp, txt/md,
  docx/xlsx/pptx/odt; max 5 MB, 20 per student, 5 s apart).
- STUN (route discovery only, no data) uses Cloudflare's public `stun:stun.cloudflare.com:3478`.
- The teacher can remove a student (that Google account can't rejoin the class) and lock the class.
- Limits: 100 students, teacher message rate/size caps, origin allow-list, per-IP create/join limits (in memory only,
  never stored), idle expiry.
