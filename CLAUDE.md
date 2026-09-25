# Patchwork

- Push finished work straight to `main` (the owner's standing instruction). GitHub Pages serves `main`.
- The app is a single file, `index.html`, with no build step. Keep it local-first: no network requests, accounts or telemetry.
- Database changes only ever ADD a Dexie version or table; never wipe or rewrite existing user data.
