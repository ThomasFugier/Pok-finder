# Pokefinder Party

A fullstack real-time multiplayer browser game inspired by party guessing games, focused on the original 151 Pokemon.

## Stack

- Frontend: React + Vite + Zustand + Socket.IO client
- Backend: Node.js + Express + Socket.IO
- Realtime sync: room state, rounds, timer, scores, votes

## Local solo fallback

If the backend is not running, the frontend still works:

- Use the `Solo local` button on the home screen.
- You can play a full single-player session entirely in-browser.
- The main menu now includes all pre-game settings in one place (nickname, avatar, rounds, language, mode, timer).
- Hidden silhouette is now a separate display option: `Who's that Pokemon mode` / `Qui est ce Pokémon?`.
- Display mode and scoring mode are independent settings.
- New rooms default to the system language (French OS/browser -> `fr`, otherwise `en`).
- Round result uses a progress bar and a host-only `Suivant` button (disabled for other players).
- `Quitter` always returns to the main menu; if host quits, the room closes for everyone.

## Windows one-click static launch

From the project root, double-click `launch-client-static.bat`.

- It installs client deps if needed
- Builds `client/dist`
- Starts a local static preview server and opens the browser

Tip: you can run `launch-client-static.bat --check` to only validate the build.

## Structure

- `client` - React application
- `server` - Express + Socket.IO server

## Local development

1. Install dependencies:
   - `cd server && npm install`
   - `cd client && npm install`
2. Run backend:
   - `cd server && npm run dev`
3. Run frontend:
   - `cd client && npm run dev`
4. Open the frontend URL shown by Vite.

## Environment

### Client

- `VITE_SERVER_URL` (optional) defaults to `http://localhost:4000`

### Server

- `PORT` (optional) defaults to `4000`
- `CLIENT_ORIGIN` (optional) defaults to `http://localhost:5173`

## Deployment notes

- Frontend (Vercel/Netlify): set `VITE_SERVER_URL` to your backend URL.
- Backend (Render/Fly.io): expose `PORT`, set `CLIENT_ORIGIN` to deployed frontend origin.
