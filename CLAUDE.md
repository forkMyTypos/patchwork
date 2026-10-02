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
  See "Screen size / scaling / viewports / screens" below. Run sizes are stored in px; on screen each line's font-size is its
  largest run (Docs-like line height) and runs are em of that. Screen x goes through `sx()`.
- Ink: new strokes (`u:1`) are in page units (same scale as text, `inkW`); old strokes are relative to `drawW`. Strokes anchor to a
  paragraph (`a={p:paragraph id,top}`; paragraphs have stable ids saved as `data-id`) and move with it. Always place ink via
  `inkU(s)`/`inkDy(s)`; create strokes from screen coords with `addViewStroke()`.
- Database changes only ever ADD a Dexie version or table; never wipe or rewrite existing user data.
- Work as a surgical builder: read only what the task needs, make the smallest change, test it, report briefly
  (DONE / Changed / Tested / Notes). No unrequested features, refactors or new files.

## Screen size / scaling / viewports / screens (owner's decisions, keep)

- CURRENT (option C, "never shrink, scroll sideways"): every page is shown at REAL SIZE everywhere (15px is 15px on any
  screen, teacher, student, class page, pop-ups, timeline). The page is `ww` wide; a narrower window scrolls/pans sideways,
  a wider one shades beyond the page. Nothing is scaled. Like a PDF/canvas bigger than the screen.
- Students follow the teacher: the snapshot carries `scroll` (y) and `fx` (teacher's caret x, 0-1, `clsFocusX()`); with
  Autofocus on, the student's view scrolls to keep that spot in view.
- `fonts/` bundles an Arial-metric font (Liberation Sans subset renamed Patchwork Sans, OFL) as 'Arial' so text measures the
  same on every computer. `ww` travels with backups, timeline snapshots, class snapshots/copies and hand-ins.
- Rejected, and why: fit-to-window scaling of a fixed sheet (15px looked ~25px on big class screens and 7.5px on laptops);
  zoom/Fit buttons (owner wants pages to behave like normal pages); pure reflow (ink drifts off words); word-level ink anchors.
- Possible later: a per-page "Re-fit to this window" (rewrap once at a new `ww`); a phone reading view.

## AI mode / Create with AI (owner's thinking, UNDECIDED - nothing built yet, keep)

- Status: the owner is still deciding what AI should do in Patchwork; "maybe a simple copy and paste works just as well".
  Do not build any of this until asked.
- Proposed name: "Create with AI" (would replace the "AI board link" menu item; the board link would live inside it as
  "External AI tools (experimental)").
- Owner's spec (2026-10-02), core rule: AI may suggest, explain, generate or propose; the user stays in control. AI never
  silently edits the page, nothing is sent unless the user explicitly asks, only the selection is sent (Whole page is an
  explicit choice). Actions: Hint (no answers), Check my work, Explain, Suggest edits (Accept/Dismiss proposals),
  Continue, Generate, Ask AI. Results reuse Patchwork objects: Note/Question highlights linked to the source (marks
  `links`), proposals, new content the user inserts. Provider-independent (Anthropic, OpenAI, Google, local), no framework.
- Firm decisions: NO Google login for Create with AI. User's own API key, kept only in this browser (never in backups,
  exports, classroom traffic or the AI link); no Patchwork AI server; browser talks straight to the chosen provider.
  Classroom: teacher may switch AI actions on/off for the class (like Homework mode); student AI requests never go to
  the teacher or other students.
- Two routes discussed: (1) Create with AI = browser -> provider with the user's key; (2) give the AI board link a
  user-granted read permission (Off / Selection / Whole page, `readPage` command) so an external AI (e.g. Claude via
  curl) can read and leave notes/questions - text would pass through the relay in memory, never stored.
- Smallest first slice if approved: provider + key settings, selected text only, Hint/Explain/Check/Ask -> linked
  Note/Question cards; then Whole page, proposals, class switches, more providers.
- Open questions for the owner: menu rename, first provider(s), default model, OK for the asked-about text to get a
  source highlight.

## Files (classic scripts sharing globals; load order in index.html matters)

- `css/patchwork.css` - all page styles
- `js/vendor/` - DOMPurify, Dexie, `pdfjs/` (pdf.js legacy build, Apache-2.0; loaded only on PDF import) - all local for offline use
- `js/editor.js` - rich-text editor (`makeEditor`) and the draw-an-image modal
- `js/app.js` - database schema, projects, page, ink, marks, margin, panels, keyboard, boot (on DOMContentLoaded)
- `js/images.js` - image store (pw-img:<hash> blobs)
- `js/highlights.js` - highlight types, profiles, Highlight Factory
- `js/explorer.js` - highlight Explorer
- `js/timeline.js` - history snapshots + Timeline view
- `js/handwriting-core.js`, `js/handwriting.js` - recogniser core; language modules + Handwriting Lab
- `js/backup.js`, `js/about.js`, `js/menu.js` - backup/import (JSON backups; PDFs -> a new private page of page images, `importPdf`); About panel; main menu (logo) + light mode
- `js/classroom.js` - optional classroom: teacher broadcast, read-only Teacher View window for students
- `js/ai-board.js` - experimental AI board link: receives the 4 commands, creates highlights (addMark) / doodles (commitStroke)
- `relay/` - classroom relay: `relay-core.mjs` (logic), `ai-board.mjs` (AI board link), `worker.mjs` + `wrangler.toml` (Cloudflare), `schema.sql` (D1 log), `dev-server.mjs` (local, needs `ws`); setup in `relay/README.md`
- `tools/hw-eval/` - offline recogniser evaluation (test-only)
