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
  Teaching Mode has two interchangeable views (`CLS.mode`, chosen on create/join, switchable from the Class menu):
  'default' = big CLASS area + private pop-up editors (teacher: the main window IS the class, `clsMainIsClass()`, sharable only;
  student: `.cls-pane.cls-full` shows the teacher's page); 'split' = PRIVATE | CLASS at exactly 50:50 (teacher's CLASS side is a
  `?mini=1&class=1` editor). Broadcast source = `clsBoardWin()`, re-checked as sharable in the DB on every send. Students'
  pen marks on the class page stay local. Hand-ins only while the teacher's Homework mode is on (enforced in the teacher's browser).
  Second, EXPERIMENTAL exception: the opt-in AI board link (`js/ai-board.js` + `relay/ai-board.mjs`, same relay). Off unless
  switched on (Google sign-in); an external client with the board's key may send ONLY createQuestion/createAnswer/createNote
  (plain text -> highlights via addMark) and drawStrokes (capped doodle -> pen strokes via commitStroke, below existing work). The relay keeps only key hashes in memory; nothing stored.
- Projects are PRIVATE by default (`shared!==true`). Only sharable projects may be broadcast (teacher's class area) or used by
  the AI link; check `isShared(pid)` at every sharing point. Making a project private fires `pw-private` and stops sharing.
- Page width: each page stores `ww` (px at real size, the width it was written at; older pages get it frozen on first open).
  Layout scales `ww` to the window: down only (`k=min(1,fit/ww)`) normally, exactly to fit on the class page (`pageScaled()`);
  wider windows shade beyond the page. `ww` travels with backups, snapshots, class snapshots/copies. `fonts/` bundles an
  Arial-metric font (OFL) as 'Arial' so text wraps the same everywhere. Run sizes are stored in px; on screen each line's
  font-size is its largest run (Docs-like line height) and runs are em of that. Screen x goes through `sx()`.
- Ink: new strokes (`u:1`) are in page units (same scale as text, `inkW`); old strokes are relative to `drawW`. Strokes anchor to a
  paragraph (`a={p:paragraph id,top}`; paragraphs have stable ids saved as `data-id`) and move with it. Always place ink via
  `inkU(s)`/`inkDy(s)`; create strokes from screen coords with `addViewStroke()`.
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
- `js/ai-board.js` - experimental AI board link: receives the 4 commands, creates highlights (addMark) / doodles (commitStroke)
- `relay/` - classroom relay: `relay-core.mjs` (logic), `ai-board.mjs` (AI board link), `worker.mjs` + `wrangler.toml` (Cloudflare), `schema.sql` (D1 log), `dev-server.mjs` (local, needs `ws`); setup in `relay/README.md`
- `tools/hw-eval/` - offline recogniser evaluation (test-only)
