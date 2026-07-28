# Lobby Bots — Design Spec

**Date:** 2026-07-26
**Status:** Approved for implementation

## Goal

Let the host of a private table fill empty seats with AI-controlled players
("bots") before starting, so a game can be played with fewer than 3–6 real
people. Bots bid, choose trump, and play cards on their own, using a simple
heuristic — no tracking of played cards or opponent modeling.

## Scope

- Private lobbies only (a table the host created via `room:create` or
  joined via `room:join`). Public quick-match tables (`room:quickMatch`)
  are unaffected — always real strangers, no bot fallback. That's an
  explicitly separate, undecided future feature.
- Bots can only be added or removed while the room is in the lobby phase,
  by the host (seat 0). Once a game starts, bot seats are fixed — no
  mid-game swap to a human. The existing claim-code seat-transfer system is
  untouched.
- Bots count toward the 3–6 player range like any other player. A host
  could fill all 5 remaining seats and play solo against bots.

## Player model

`Player` (in `apps/server/src/rooms.ts`) gains one field:

```ts
interface Player {
  name: string;
  token: string;
  connected: boolean;
  lastEmoteAt: number;
  isBot: boolean;
}
```

A bot is a normal player with a real (internally generated, never
transmitted) token — every existing token-based mechanism (`seat()`,
`applyIntent`, etc.) keeps working unchanged. Bots are always
`connected: true` (no socket, so `setConnected` never touches them).

`PublicPlayer` (in `packages/shared/src/protocol.ts`) gains `isBot: boolean`
so every client can see who's a bot (host and non-host alike).

## Bot lifecycle

- **Naming:** a themed pool — `Golem`, `Familiar`, `Homunculus`, `Specter`,
  `Wraith` (5 names, enough for the 5 seats a host could possibly fill).
  Pick the first unused name in the room; if the pool is exhausted (should
  not happen given `MAX_PLAYERS = 6` and at least one human host), fall
  back to `Bot 1`, `Bot 2`, etc.
- **Adding:** `RoomManager.addBot(code, hostToken)` — host-only, lobby-only
  (`!room.game`), rejects if the room is already full. Appends a new bot
  `Player`, returns `{ seat, name }`.
- **Removing:** `RoomManager.removeBot(code, hostToken, seat)` — host-only,
  lobby-only, rejects if the target seat isn't a bot. Removes it from
  `room.players` (same as a human leaving the lobby).

## How bots take turns

No polling, no per-bot timers running independent of game state. Every
place the server already calls `broadcast(code)` — after `room:start`,
`game:chooseTrump`, `game:bid`, `game:play`, and the existing round-advance
timer — is the single hook point.

1. After `broadcast(code)` sends state to every real socket, it calls a new
   `scheduleBotTurn(code)` in `apps/server/src/app.ts`.
2. `scheduleBotTurn` clears any existing bot timer for that room code, then
   asks `RoomManager.pendingBotSeat(code): number | null` — the seat whose
   action is currently awaited (dealer for `choosingTrump`, `turnIndex` for
   `bidding`/`playing`, `null` for phases with no pending action), but only
   if that seat is a bot.
3. If a bot is pending, schedule a `setTimeout` for a random delay between
   `BOT_MIN_DELAY_MS` (700) and `BOT_MAX_DELAY_MS` (1800), so bot moves
   don't feel instant. When it fires: call `RoomManager.playBotTurn(code)`
   (computes and applies that bot's decision), then `broadcast(code)` again
   — which re-enters this same hook, so a run of consecutive bots (e.g.
   three bots bidding back to back) cascades on its own with no special
   casing.

`RoomManager.playBotTurn(code): boolean` internally re-derives the pending
actor (same logic as `pendingBotSeat`, factored into a private
`pendingActor(room)` helper used by both), confirms it's still a bot (in
case state changed between scheduling and firing — e.g. the room emptied),
computes the decision via the heuristics below, and applies it through the
same `applyIntentAtSeat` core the human-token paths use (see Refactor,
below). Returns `false` (no-op) if nothing is pending or the pending seat
isn't a bot anymore.

## Refactor: shared seat-based apply core

`RoomManager.applyIntent(code, token, fn)` currently resolves a token to a
seat and applies `fn`. Split out the seat-based half:

```ts
private applyIntentAtSeat(
  room: Room,
  seat: number,
  fn: (game: GameState, seat: number) => GameState,
): void {
  if (!room.game) throw new GameError('no_game', 'The game has not started');
  room.game = fn(room.game, seat);
  room.lastActivity = Date.now();
}

private applyIntent(code: string, token: string, fn: ...): void {
  const room = this.room(code);
  const seat = this.seat(room, token);
  this.applyIntentAtSeat(room, seat, fn);
}
```

`play()`'s `completedGames` bookkeeping (increment once, exactly when the
game transitions into `gameOver`) moves to wrap `applyIntentAtSeat` calls
in both `play()` and `playBotTurn`'s `'play'` case, so the increment logic
exists in exactly one place conceptually (duplicated as the same three
lines in two call sites, not extracted further — YAGNI, it's three lines).

## Bot decision heuristics

All heuristics are pure functions in a new file, `apps/server/src/bot.ts`,
operating on the full (non-redacted) `GameState` from `packages/shared`
(the bot logic runs server-side and may see its own full hand plus public
trick/trump state — never other players' hands, matching what a human at
that seat would see).

**Bidding — `chooseBotBid(game, seat): number`:**
- Estimate expected tricks from hand strength: `+1` per Wizard, `+0.5` per
  trump-suit card, `+0.3` per non-trump suit card valued `>= 10`. Jesters
  contribute `0`.
- Round to the nearest integer, clamp to `[0, game.round]`.
- If this seat is the forced last bidder, reuse the existing
  `forbiddenBid(game)` export from `packages/shared` (already used to gray
  out that option in the human bid picker) — if the estimate equals the
  forbidden number, nudge it by `+1` (or `-1` if already at `game.round`),
  re-clamping to `[0, game.round]`.

**Trump choice — `chooseBotTrump(game, seat): Suit`:** the suit this seat's
hand holds the most cards of. Tie-break by iteration order of `Suit`
(`red`, `yellow`, `green`, `blue`).

**Card play — `chooseBotCard(game, seat): string`:** among
`legalCardIds(game, seat)` (the existing engine export — guarantees
follow-suit correctness, so a bot can never attempt an illegal play):
- Rank every legal card: Wizards highest, Jesters lowest, suit cards by
  `value` (trump suit cards rank above same-value non-trump).
- If `tricksWonSoFar < bid` for this seat (still needs tricks), play the
  highest-ranked legal card (try to win).
- Otherwise (bid already met or exceeded), play the lowest-ranked legal
  card (try to lose/dump).

This applies identically whether leading or following — `legalCardIds`
already returns "everything" when leading and the follow-suit-filtered set
when following.

## Protocol changes

`packages/shared/src/protocol.ts`:

```ts
'room:addBot': (cb: (r: Reply<{ seat: number; name: string }>) => void) => void;
'room:removeBot': (payload: { seat: number }, cb: (r: Reply<object>) => void) => void;
```

`PublicPlayer` gains `isBot: boolean`.

## Server wiring (`apps/server/src/app.ts`)

Two new socket handlers, following the existing `room:leave`-style pattern
(host/room checks live in `RoomManager`, the handler just calls through and
broadcasts):

```ts
socket.on(
  'room:addBot',
  safe((_payload, cb) => {
    if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
    const { seat, name } = rooms.addBot(data.code, data.token);
    cb({ ok: true, seat, name });
    void broadcast(data.code);
  }),
);

socket.on(
  'room:removeBot',
  safe((payload, cb) => {
    if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
    rooms.removeBot(data.code, data.token, Number(payload.seat));
    cb({ ok: true });
    void broadcast(data.code);
  }),
);
```

Plus the `scheduleBotTurn` mechanism described above, following the same
shape as the existing `scheduleAdvance`/`schedulePublicStart` timer maps.

## Client changes

- `apps/web/src/socket.ts`: `api.addBot()` and `api.removeBot(seat)`.
- `apps/web/src/screens/Lobby.tsx`: host-only "Add a bot" button (disabled
  at 6/6 seated), and a small host-only remove control on each bot's row.
  A "bot" tag renders next to bot names (same visual treatment as the
  existing "host" tag) — visible to everyone, not just the host.
- `apps/web/src/screens/Game.tsx`: the same "bot" tag on bot players'
  seat chips during play, so it's clear who you're playing against.

## Not touched

- Public quick-match (`RoomManager.quickMatch`, the auto-start countdown).
- The admin dashboard — bots appear in the existing player/room counts
  with no dedicated bot-specific stat.
- The claim-code seat-transfer system.
- `packages/shared`'s pure engine (`legalCardIds`, `forbiddenBid`,
  `placeBid`, `playCard`, `chooseTrump`) — bots consume it, don't change it.

## Testing

Extend `apps/server/test/rooms.test.ts`:
- `addBot`/`removeBot`: correct name assignment and pool exhaustion
  fallback, host-only enforcement, room-full rejection, lobby-only
  enforcement (rejected once `room.game` exists), rejecting removal of a
  non-bot seat.
- A full simulated game with a human host plus 2+ bots, driven purely by
  repeated `rooms.playBotTurn(code)` calls (no bot ever needs a human
  token) through bidding, trump selection when a bot is dealer, play, and
  into `roundEnd`/`gameOver` — asserting no `GameError` is ever thrown
  (which would mean a bot attempted something illegal) and that
  `completedGames` still increments exactly once, matching the existing
  human-only test for that invariant.
- A bidding scenario that forces a bot into the last-bidder seat, asserting
  its bid is never the forbidden number (exercises the `forbiddenBid`
  nudge).

No new client-side automated tests — no frontend test framework is
configured in this repo (consistent with prior features in this codebase).
Manual/visual verification in the browser: add a bot, see it tagged and
counted toward the 3-player minimum, start a game, watch it bid/choose
trump/play with a visible short delay, confirm a full round completes
without the game stalling.
