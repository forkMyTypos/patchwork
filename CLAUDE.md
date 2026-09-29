# Patchwork

- Push finished work straight to `main` (the owner's standing instruction). GitHub Pages serves `main`.
- Plain files, no build step, no framework. Keep it local-first: no network requests, accounts or telemetry.
  The ONE exception is the opt-in classroom (`js/classroom.js` + `relay/`): it connects only when a user creates/joins
  a classroom. The relay is SIGNALLING ONLY (sign-in, roster, kick/lock, WebRTC offer/answer/ICE); classroom data
  (teacher broadcast, student hand-ins) goes browser-to-browser over WebRTC data channels, never through the relay,
  and no TURN server is used. Broadcast is teacher -> students only; the only student -> teacher path is an explicit
  hand-in, checked by the teacher's browser (allow-listed types, size/rate caps). Received data is validated before use.
  Teaching mode requires Google sign-in; the relay logs only Google account ID + join/leave times (D1, deleted after
  90 days). Never store IP addresses, names, emails or classroom content.
- Database changes only ever ADD a Dexie version or table; never wipe or rewrite existing user data.
- Work as a surgical builder: read only what the task needs, make the smallest change, test it, report briefly
  (DONE / Changed / Tested / Notes). No unrequested features, refactors or new files.

## Files (classic scripts sharing globals; load order in index.html matters)

- `css/patchwork.css` - all page styles
- `js/vendor/` - DOMPurify, Dexie (kept local for offline use)
- `js/editor.js` - rich-text editor (`makeEditor`) and the draw-an-image modal
- `js/app.js` - database schema, projects, page, ink, marks, margin, panels, keyboard, boot (on DOMContentLoaded)
- `js/images.js` - image store (pw-img:<hash> blobs)
- `js/highlights.js` - highlight types, profiles, Highlight Factory
- `js/explorer.js` - highlight Explorer
- `js/timeline.js` - history snapshots + Timeline view
- `js/handwriting-core.js`, `js/handwriting.js` - recogniser core; language modules + Handwriting Lab
- `js/backup.js`, `js/about.js`, `js/menu.js` - backup/import; About panel; main menu (logo) + light mode
- `js/classroom.js` - optional classroom: teacher broadcast, read-only Teacher View window for students
- `relay/` - classroom relay: `relay-core.mjs` (logic), `worker.mjs` + `wrangler.toml` (Cloudflare), `schema.sql` (D1 log), `dev-server.mjs` (local, needs `ws`); setup in `relay/README.md`
- `tools/hw-eval/` - offline recogniser evaluation (test-only)
