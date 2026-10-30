# tapmemory.io

The Tap Memory website: a retro boot-up desktop (BIOS screen, login, splash, desktop) with the Join Tap Memory wallet sign-up, $TAP, re:member, Our Products, Discord and Links.

- `index.html` is the whole site (images are embedded).
- `backend/tapmemory-backend.gs` is the Google Apps Script that saves submitted wallets to a Google Sheet. Paste its web app URL into `SIGNUP_ENDPOINT` in `index.html`.

Deployed on Vercel. Pushing to `main` redeploys automatically.

## Timeline Verse (`/poem`)

Type an X handle and get a poem written from that account's recent posts, replies, likes and comment counts.

- `poem/index.html` is the page; `api/poem.js` is a Vercel serverless function that calls the X API and the Claude API.
- Set these in Vercel → Project → Settings → Environment Variables, then redeploy:
  - `X_BEARER_TOKEN`: bearer token from the X Developer Console (pay-per-use credits; about $0.50 per new handle, cached for an hour)
  - `ANTHROPIC_API_KEY`: Claude API key from console.anthropic.com
  - optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `POEMS_PER_IP_HOUR` (default 5), `POEMS_PER_DAY` (default 200)
- Links like `/poem?u=tapmemory` open with the handle filled in.
