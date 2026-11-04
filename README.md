# The Pods website

## What's inside
- `server.js`: the backend (API, owner sign-in, storage, uploads)
- `public/index.html`: the main site, admin panel (secret badge), reservations, team leaderboard
- `public/gallery.html`: the gallery page with its own owner photo manager
- `public/images/`: the two venue photos
- `data/`: created on first run. Holds content, reservations, votes and uploads metadata
- `public/uploads/`: photos the owner adds

## Run it
1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Set a long owner key and start the server:
   - Mac/Linux: `OWNER_KEY="use-a-long-secret-phrase" npm start`
   - Windows (PowerShell): `$env:OWNER_KEY="use-a-long-secret-phrase"; npm start`
4. Open http://localhost:3000

## First-time setup
1. Open the site and tap "THE PODS" five times quickly.
2. Enter the owner key and open the editor.
3. Edit the menu, details, pods and team, then press Save and publish.
   Publishing once is required before votes and shout-outs work.

## Going live
- Put the server on any Node host (Render, Railway, Fly.io, or a VPS) with HTTPS.
- Point your domain at it. Keep `OWNER_KEY` in the host's environment settings, never in the code.
- Back up the `data/` and `public/uploads/` folders regularly.

## Security notes
- The owner key is a single shared secret, good for one owner. For several staff, add
  individual accounts before going live.
- Only the owner key can change content, see reservations, and upload photos.
- Guests cannot write content. Votes and shout-outs are limited to one per guest per item
  per IP address, plus a rate limit.
- Put the site behind HTTPS so the owner key is never sent in plain text.
