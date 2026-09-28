# Patchwork classroom relay

A tiny Cloudflare Worker that relays a teacher's broadcast to students and hand-ins from students to the teacher.
It stores nothing: classrooms live in memory and vanish when the teacher ends them or after 3 idle hours.

## Deploy (about 10 minutes, free plan is enough)

1. **Cloudflare account**: sign up at https://dash.cloudflare.com/sign-up (free).
2. **Node.js 18+** on your computer: https://nodejs.org (check with `node -v`).
3. **Get this folder**: `git clone https://github.com/forkMyTypos/patchwork` then `cd patchwork/relay`.
4. **Log in**: `npx wrangler login`. A browser window opens; approve access.
5. **Allowed site**: `wrangler.toml` already allows `https://forkmytypos.github.io`.
   If Patchwork is served from somewhere else, add that origin (comma-separated, no trailing slash).
6. **Deploy**: `npx wrangler deploy`.
   The first time, wrangler may ask you to choose/register a `workers.dev` subdomain; accept.
   It prints an address like `https://patchwork-classroom.<you>.workers.dev`.
7. **Check it**: open that address in a browser. You should see `Patchwork classroom relay`.
8. **Use it**: in Patchwork, click the logo, then Classroom, and paste the address into "Classroom server".
   Everyone (teacher and students) uses the same address.

Update later with `npx wrangler deploy` again. Watch live logs with `npx wrangler tail`.
Remove it with `npx wrangler delete`.

## Local testing without Cloudflare

```sh
cd relay && npm i ws && node dev-server.mjs 8787
```

Then use `http://localhost:8787` as the classroom server (only localhost is allowed over plain http).

## What the relay enforces

- Random 10-character codes; the teacher proves their role with a 256-bit secret (roles are never taken from the client).
- Students may only: join (with a display name), keep alive, and hand in a file to the teacher.
- Hand-ins: pdf, images (png/jpg/gif/webp), txt/md, docx/xlsx/pptx/odt; max 5 MB, 20 per student, 5 s apart;
  delivered only to the teacher's connection (refused if the teacher is offline); never stored or broadcast.
- Teacher can remove a student (that browser can't rejoin this class) and lock the class (no new students).
- Limits: 100 students, teacher message rate and size caps, origin allow-list, per-IP create/join limits, idle expiry.
