# tapmemory.io

The Tap Memory website: a retro boot-up desktop (BIOS screen, login, splash, desktop) with the Join Tap Memory wallet sign-up, $TAP, re:member, Our Products, Discord and Links.

- `index.html` is the whole site (images are embedded).
- `backend/tapmemory-backend.gs` is the Google Apps Script that saves submitted wallets to a Google Sheet. Paste its web app URL into `SIGNUP_ENDPOINT` in `index.html`.

Deployed on Vercel. Pushing to `main` redeploys automatically.
