# Wizard Online — Design Spec

**Date:** 2026-07-24
**Status:** Approved for implementation (user delegated design decisions)

## Goal

A mobile-optimized webapp to play the card game **Wizard** (Ken Fisher / Amigo) online
with friends. Self-hosted as a single Docker container on the user's Portainer instance.

## Game rules (standard)

- 60 cards: 4 suits (red, yellow, green, blue) with values 1–13, plus 4 **Wizards** (Z)
  and 4 **Jesters** (N).
- 3–6 players. Number of rounds = 60 / player count (3p→20, 4p→15, 5p→12, 6p→10).
  Round *r* deals *r* cards to each player.
- After dealing, the top card of the remaining deck is flipped as **trump indicator**:
  - Suit card → that suit is trump.
  - Jester → no trump this round.
  - Wizard → the **dealer chooses** the trump suit before bidding.
  - Final round (no cards left) → no trump.
- **Bidding**: starting left of the dealer, each player predicts how many tricks they
  will win (0..r). No restriction on the bid total (standard rules).
- **Trick play**: player left of the dealer leads the first trick; the winner of a trick
  leads the next.
  - Wizards and Jesters may always be played.
  - If a suit card leads, players must follow suit if they can (Wizard/Jester always legal).
  - If a **Wizard** leads, there is no suit to follow; everyone may play anything.
  - If a **Jester** leads, the first suit card played sets the suit to follow.
  - Trick winner: first Wizard played wins; otherwise highest trump; otherwise highest
    card of the led suit; if only Jesters were played, the first Jester wins.
- **Scoring** per round: exact bid → 20 + 10 × tricks won; otherwise −10 per trick of
  difference. Highest total after the last round wins.

## Architecture

TypeScript monorepo with npm workspaces:

```
packages/shared   – pure game engine + protocol types (no I/O, fully unit-tested)
apps/server      – Node 22, Fastify + Socket.IO; authoritative state, room manager
apps/web         – React 18 + Vite, mobile-first UI, Socket.IO client
```

### Server

- **Rooms**: in-memory `Map<code, Room>`; 4-letter join codes. Host creates a room,
  others join with the code (or a share link `/#/room/CODE`). Host starts the game once
  3–6 players joined.
- **Authority**: all game logic runs server-side via the shared engine. Clients send
  intents (`bid`, `playCard`, `chooseTrump`); server validates, applies, and broadcasts.
- **Redaction**: each player receives only their own hand; other hands are card counts.
- **Sessions/reconnect**: on first connect the server issues a random session token the
  client stores in `localStorage`. Rejoining with the token restores the player's seat
  mid-game; disconnected players are badged and the game waits on their turn.
- **Cleanup**: rooms idle for 2 hours are garbage-collected.
- No database, no accounts — deliberate scope choice for a self-hosted friends server.

### Client

- Screens: **Home** (create/join), **Lobby** (players, share link, start), **Game**
  (hand fan, trick area, bid dialog, trump display, turn indicator, live scoreboard),
  **Game over** (final standings, play again).
- Mobile-first layout; cards rendered as styled DOM/SVG (no image assets), dark
  "arcane" visual theme, subtle animations for dealing/playing cards.
- State: single reducer fed by server snapshots; optimistic UI not needed (turn-based).

### Protocol (Socket.IO events)

Client→server: `room:create`, `room:join`, `room:leave`, `room:start`,
`game:bid`, `game:play`, `game:chooseTrump`, `room:again`.
Server→client: `room:state` (lobby), `game:state` (redacted snapshot),
`game:event` (trick won, round scored — for animations/toasts), `error`.

## Error handling

- Invalid intents (out of turn, illegal card, bad bid) are rejected with an `error`
  event; server state never mutates on invalid input.
- Unknown room code / full room / game already started → typed error responses on join.
- Socket disconnect ≠ leaving: seat is held for reconnect until the room is GC'd or the
  host closes it.

## Testing

- **Engine** (packages/shared): Vitest unit tests for deck composition, dealing, trump
  determination, follow-suit legality, trick winner (all special cases: wizard lead,
  jester lead, all jesters, trump), scoring, and full round/game state transitions.
- **Server**: integration test of a scripted 3-player game over the room manager.
- **Client**: verified end-to-end in the browser with multiple tabs (manual/agentic).

## Deployment (Portainer)

- Multi-stage `Dockerfile`: build web + server, run on `node:22-alpine` as non-root;
  server serves the built SPA and Socket.IO on port **8080**; `/healthz` endpoint.
- `docker-compose.yml` usable directly as a Portainer stack (build from repo URL or
  pull after `docker build`). Single service, one exposed port, restart policy.
- README documents both Portainer flows (stack from git repo / prebuilt image).

## Implementation plan

1. Scaffold monorepo (workspaces, TS config, Vitest, ESLint/Prettier minimal).
2. TDD the game engine in `packages/shared`.
3. Server: room manager + socket handlers + static serving.
4. Web client UI (frontend-design skill), wired to the socket protocol.
5. Dockerfile + compose + README.
6. End-to-end verification in browser (3 tabs, full mini-game), then commit.
