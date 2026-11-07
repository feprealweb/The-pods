# Banc Restaurant website

## Files
- `server.js`: the backend (API and web server). Uses only built-in Node.js modules.
- `public/index.html`: the website (front end).
- `package.json`: start script and Node version.
- `.gitignore`: keeps saved data and secrets out of version control.
- `data.json`: created automatically on first save. This is the database. Back it up.

## Run it on your computer
1. Install Node.js 18 or newer from https://nodejs.org
2. Open a terminal in this folder.
3. Run:

   Mac/Linux:  `ADMIN_PASSWORD="your-strong-password" npm start`
   Windows (PowerShell):  `$env:ADMIN_PASSWORD="your-strong-password"; npm start`

4. Open http://localhost:3000 in your browser.

The admin panel is still opened with five taps on the logo, then the staff password you set in `ADMIN_PASSWORD`.

## Before going live
- Host it on a service that supports Node.js (for example Render, Railway, or a VPS) and make sure it uses HTTPS.
- Use a long, unique `ADMIN_PASSWORD` set as an environment variable on the host. Never put it in the code.
- Replace the placeholder WhatsApp number and email in `public/index.html` (`RESTAURANT_WA` and `RESTAURANT_EMAIL`).
- Back up `data.json` regularly.
- Payments are simulated. A real payment provider must be added before taking card payments.

## Important
The website in `public/index.html` still saves its data on each visitor's device. The server stores data for the API, but the page is not yet connected to it. Connecting the page to the API is the next build step.
