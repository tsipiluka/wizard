# 🔮 Wizard — trick-taking by candlelight

Play the card game **Wizard** (Ken Fisher) online with 3–6 friends. Mobile-first,
self-hosted, no accounts and no database — create a table, share the link, play.

## Features

- Full standard Wizard rules: 60-card deck (4 suits, 4 Wizards, 4 Jesters),
  escalating rounds, trump flip with dealer choice on a Wizard, exact-bid scoring
  (20 + 10·tricks, −10 per trick off).
- Rooms with 4-letter codes and share links; the game is fully server-authoritative
  (hands are never sent to other players).
- Seamless reconnect: your seat survives page reloads, phone sleep, and network blips.
- Dark "grimoire" design with hand-drawn card sigils, optimized for phones.

## Project layout

```
packages/shared   pure game engine + protocol types (unit-tested)
apps/server       Fastify + Socket.IO, serves the SPA, keeps rooms in memory
apps/web          React + Vite client
```

## Deploy on Portainer

Every push to `main` builds and publishes `ghcr.io/tsipiluka/wizard:latest`
(amd64 + arm64) via GitHub Actions, after the test suite passes.

**Option A — pull the published image (recommended):**

1. Portainer → *Stacks* → *Add stack* → *Web editor*, paste:

   ```yaml
   services:
     wizard:
       image: ghcr.io/tsipiluka/wizard:latest
       restart: unless-stopped
       ports:
         - "8080:8080"
   ```

2. Deploy. Re-pull the image + redeploy the stack to update.

> **Note:** GHCR packages start out private. Either make the package public
> (GitHub → your profile → *Packages* → `wizard` → *Package settings* →
> *Change visibility*), or add `ghcr.io` registry credentials in Portainer
> (*Registries* → *Add registry*, username = GitHub handle, password = a
> classic PAT with `read:packages`).

**Option B — build from this repository:**

1. Portainer → *Stacks* → *Add stack* → *Repository*.
2. Repository URL: `https://github.com/tsipiluka/wizard`, compose path
   `docker-compose.yml` (this builds the image on the Portainer host).

**Option C — plain Docker:**

```bash
docker run -d --name wizard -p 8080:8080 --restart unless-stopped ghcr.io/tsipiluka/wizard:latest
```

Put it behind your reverse proxy (Traefik/NPM/Caddy) with WebSocket support enabled
(Socket.IO uses `/socket.io`). A `/healthz` endpoint is available for health checks.

Rooms live in memory: a container restart ends running games (players' browsers
return to the home screen). Idle rooms are cleaned up after 2 hours.

## Development

```bash
npm install
npm test                # engine + room manager tests (vitest)
npm run dev:server      # Fastify + Socket.IO on :8080
npm run dev:web         # Vite dev server on :5173 (proxies /socket.io)
```

Open `http://localhost:5173` in several browser profiles/devices to play. The
production server serves the built SPA itself: `npm run build`, then run
`node apps/server/dist/index.js`.

## Rules refresher

Each round deals one more card than the last (3 players → 20 rounds, 4 → 15,
5 → 12, 6 → 10). After the deal, the next card sets trump — a Jester means no
trump, a Wizard lets the dealer pick, and the final round has none. Everyone
predicts their exact number of tricks; Wizards always win a trick, Jesters never
do. Hit your bid for `20 + 10 × tricks`, miss it for `−10` per trick of error.
