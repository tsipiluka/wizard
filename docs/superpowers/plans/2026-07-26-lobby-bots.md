# Lobby Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host of a private table fill empty seats with AI-controlled bots before starting; bots bid, choose trump, and play cards on their own via a simple heuristic.

**Architecture:** Bots are ordinary `Player` records with `isBot: true` and a real (never-transmitted) token — every existing token-based mechanism keeps working unchanged. A new pure decision module (`apps/server/src/bot.ts`) computes bid/trump/card choices from the full `GameState`. The transport layer (`apps/server/src/app.ts`) schedules a bot's move after a short delay every time it broadcasts room state, cascading naturally through consecutive bot turns.

**Tech Stack:** TypeScript, Fastify + Socket.IO (`apps/server`), React 18 (`apps/web`), the existing `@wizard/shared` game engine. Vitest for server tests (no frontend test framework in this repo).

## Global Constraints

- Private lobbies only — public quick-match tables (`RoomManager.quickMatch`) are untouched; bots never appear there.
- Only the host (seat 0) may add or remove a bot, and only while the room is in the lobby phase (`!room.game`). Once a game starts, bot seats are fixed.
- Bots count toward the 3–6 player range like any other player.
- Bot names come from a fixed pool: `Golem`, `Familiar`, `Homunculus`, `Specter`, `Wraith` (exactly these five, in this order, first-unused-wins), falling back to `Bot 1`, `Bot 2`, … only if the pool is exhausted.
- Bidding heuristic: `+1` per Wizard, `+0.5` per trump-suit card, `+0.3` per non-trump suit card valued `>= 10`, Jesters contribute `0`; round to nearest integer; clamp to `[0, game.round]`; if forced into the forbidden last-bid number (via the existing `forbiddenBid` export), nudge by `+1` (or `-1` if already at `game.round`).
- Trump-choice heuristic: the suit the bot's hand holds the most cards of.
- Card-play heuristic: rank legal cards by Wizard (highest) > trump-suit-by-value > non-trump-suit-by-value > Jester (lowest); play the highest-ranked legal card while `tricksWon[seat] < bid[seat]`, otherwise the lowest-ranked legal card. Only ever choose among `legalCardIds(state, seat)`.
- Bot move delay: a random value between 700ms and 1800ms, so consecutive bot moves don't feel instant.
- No changes to `packages/shared`'s pure engine, the admin dashboard, or the claim-code seat-transfer system.

---

### Task 1: Shared protocol — `room:addBot`/`room:removeBot` events and `PublicPlayer.isBot`

**Files:**
- Modify: `packages/shared/src/protocol.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ClientToServerEvents` gains `'room:addBot'` and `'room:removeBot'`; `PublicPlayer` gains `isBot: boolean`. Task 3 must add `isBot` to every `PublicPlayer` object `apps/server/src/rooms.ts` constructs (its `clientState()` method) to keep the server typechecking — until then, `apps/server` typecheck will show exactly one new error there. That's expected after this task, not a defect.

- [ ] **Step 1: Add `isBot` to `PublicPlayer`**

Edit `packages/shared/src/protocol.ts`. Replace:

```ts
/** What every player may know about any player. */
export interface PublicPlayer {
  name: string;
  connected: boolean;
  isHost: boolean;
  handCount: number;
  bid: number | null;
  tricksWon: number;
  score: number;
}
```

with:

```ts
/** What every player may know about any player. */
export interface PublicPlayer {
  name: string;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  handCount: number;
  bid: number | null;
  tricksWon: number;
  score: number;
}
```

- [ ] **Step 2: Add the two new events**

In the same file, replace:

```ts
  'room:again': (cb: (r: Reply<object>) => void) => void;
  'game:chooseTrump': (payload: { suit: Suit }, cb: (r: Reply<object>) => void) => void;
```

with:

```ts
  'room:again': (cb: (r: Reply<object>) => void) => void;
  /** Fill an empty seat with an AI-controlled player; host-only, lobby-only. */
  'room:addBot': (cb: (r: Reply<{ seat: number; name: string }>) => void) => void;
  /** Remove a bot from its seat; host-only, lobby-only. */
  'room:removeBot': (payload: { seat: number }, cb: (r: Reply<object>) => void) => void;
  'game:chooseTrump': (payload: { suit: Suit }, cb: (r: Reply<object>) => void) => void;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: no output, exit code 0.

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: exactly one error, in `apps/server/src/rooms.ts`, about the object returned by `clientState()`'s `players.map` callback not satisfying `PublicPlayer` (missing `isBot`). No other errors. This is expected and resolved by Task 3 — do not fix it in this task.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "Add room:addBot/removeBot events and PublicPlayer.isBot"
```

---

### Task 2: Bot decision heuristics (`apps/server/src/bot.ts`)

**Files:**
- Create: `apps/server/src/bot.ts`
- Test: `apps/server/test/bot.test.ts`

**Interfaces:**
- Consumes: `Card`, `GameState`, `Suit`, `forbiddenBid`, `legalCardIds` from `@wizard/shared` (all already exist).
- Produces: `chooseBotBid(state: GameState, seat: number): number`, `chooseBotTrump(state: GameState, seat: number): Suit`, `chooseBotCard(state: GameState, seat: number): string` — pure functions with no side effects. Task 4 (`RoomManager.playBotTurn`) imports and calls all three.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/bot.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { type Card, type GameState, type Suit, type TrickPlay, createGame } from '@wizard/shared';
import { chooseBotBid, chooseBotCard, chooseBotTrump } from '../src/bot';

const suitCard = (s: Suit, value: number): Card => ({ kind: 'suit', suit: s, value, id: `${s}-${value}` });
const wizard = (n: number): Card => ({ kind: 'wizard', id: `wizard-${n}` });
const jester = (n: number): Card => ({ kind: 'jester', id: `jester-${n}` });
const play = (playerIndex: number, card: Card): TrickPlay => ({ playerIndex, card });

/** Build a fixed 3-player mid-game state for targeted bot-logic tests. */
function fixedState(overrides: Partial<GameState>): GameState {
  const base = createGame(3, () => 0.42);
  return {
    ...base,
    phase: 'bidding',
    round: 5,
    totalRounds: 20,
    dealerIndex: 2,
    hands: [[], [], []],
    bids: [null, null, null],
    tricksWon: [0, 0, 0],
    currentTrick: [],
    trickLeaderIndex: 0,
    turnIndex: 0,
    trumpSuit: null,
    trumpCard: null,
    ...overrides,
  };
}

describe('chooseBotBid', () => {
  test('a hand of two Wizards and a Jester estimates 2 tricks', () => {
    const state = fixedState({
      hands: [[wizard(1), wizard(2), jester(1)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBe(2);
  });

  test('a hand of low off-suit cards estimates 0 tricks', () => {
    const state = fixedState({
      trumpSuit: 'blue',
      hands: [[suitCard('red', 2), suitCard('green', 3), jester(1)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBe(0);
  });

  test('clamps to the round size even with a huge hand', () => {
    const state = fixedState({
      round: 1,
      hands: [[wizard(1), wizard(2), wizard(3), wizard(4)], [], []],
    });
    expect(chooseBotBid(state, 0)).toBeLessThanOrEqual(1);
  });

  test('never lands on the forbidden bid when forced to be the last bidder', () => {
    // Two Wizards estimates a bid of 2, but bids so far already total 3, so
    // the forbidden number for the last bidder (round 5) is exactly 5-3=2.
    const state = fixedState({
      round: 5,
      bids: [1, 2, null],
      hands: [[], [], [wizard(1), wizard(2), jester(1)]],
    });
    const bid = chooseBotBid(state, 2);
    expect(bid).not.toBe(2);
    expect(bid).toBeGreaterThanOrEqual(0);
    expect(bid).toBeLessThanOrEqual(5);
  });
});

describe('chooseBotTrump', () => {
  test('picks the suit the hand holds the most of', () => {
    const state = fixedState({
      hands: [[suitCard('green', 1), suitCard('green', 5), suitCard('red', 9), jester(1)], [], []],
    });
    expect(chooseBotTrump(state, 0)).toBe('green');
  });
});

describe('chooseBotCard', () => {
  test('plays the strongest legal card when still short of its bid', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: 'blue',
      bids: [2, 0, 0],
      tricksWon: [0, 0, 0],
      currentTrick: [],
      hands: [[suitCard('red', 3), suitCard('red', 11), wizard(1)], [], []],
    });
    expect(chooseBotCard(state, 0)).toBe('wizard-1');
  });

  test('plays the weakest legal card once its bid is already met', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: 'blue',
      bids: [1, 0, 0],
      tricksWon: [1, 0, 0],
      currentTrick: [],
      hands: [[suitCard('red', 3), suitCard('red', 11), wizard(1)], [], []],
    });
    expect(chooseBotCard(state, 0)).toBe('red-3');
  });

  test('only chooses among cards that follow the led suit when it can', () => {
    const state = fixedState({
      phase: 'playing',
      trumpSuit: null,
      bids: [2, 0, 0],
      tricksWon: [0, 0, 0],
      currentTrick: [play(1, suitCard('green', 4))],
      hands: [[suitCard('red', 13), suitCard('green', 2)], [], []],
    });
    // red-13 would rank higher, but green is led and this hand holds a green card
    expect(chooseBotCard(state, 0)).toBe('green-2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/server/test/bot.test.ts`
Expected: FAIL — `Cannot find module '../src/bot'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `apps/server/src/bot.ts`**

```ts
import { type Card, type GameState, type Suit, forbiddenBid, legalCardIds } from '@wizard/shared';

const SUIT_ORDER: Suit[] = ['red', 'yellow', 'green', 'blue'];

/**
 * A card's play strength for the simple bot heuristic: Wizards always
 * highest, Jesters always lowest, trump suit cards rank above same-value
 * non-trump, otherwise by face value.
 */
function cardStrength(card: Card, trumpSuit: Suit | null): number {
  if (card.kind === 'wizard') return 1000;
  if (card.kind === 'jester') return -1000;
  const trumpBonus = trumpSuit && card.suit === trumpSuit ? 100 : 0;
  return trumpBonus + card.value;
}

/** Estimate expected tricks from hand strength, then dodge the forbidden bid if forced to. */
export function chooseBotBid(state: GameState, seat: number): number {
  const hand = state.hands[seat] ?? [];
  let estimate = 0;
  for (const card of hand) {
    if (card.kind === 'wizard') estimate += 1;
    else if (card.kind === 'suit' && card.suit === state.trumpSuit) estimate += 0.5;
    else if (card.kind === 'suit' && card.value >= 10) estimate += 0.3;
  }
  let bid = Math.max(0, Math.min(state.round, Math.round(estimate)));
  const forbidden = forbiddenBid(state, seat);
  if (forbidden !== null && bid === forbidden) {
    bid = bid < state.round ? bid + 1 : bid - 1;
  }
  return bid;
}

/** Pick the suit this hand holds the most of, as trump. */
export function chooseBotTrump(state: GameState, seat: number): Suit {
  const hand = state.hands[seat] ?? [];
  const counts: Record<Suit, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of hand) {
    if (card.kind === 'suit') counts[card.suit]++;
  }
  return SUIT_ORDER.reduce((best, suit) => (counts[suit] > counts[best] ? suit : best));
}

/** Play to win while short of the bid, otherwise play to lose. */
export function chooseBotCard(state: GameState, seat: number): string {
  const hand = state.hands[seat] ?? [];
  const legal = new Set(legalCardIds(state, seat));
  const legalCards = hand.filter((c) => legal.has(c.id));
  const stillNeedsTricks = (state.bids[seat] ?? 0) > (state.tricksWon[seat] ?? 0);
  const sorted = [...legalCards].sort(
    (a, b) => cardStrength(a, state.trumpSuit) - cardStrength(b, state.trumpSuit),
  );
  const chosen = stillNeedsTricks ? sorted[sorted.length - 1] : sorted[0];
  return chosen!.id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/server/test/bot.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: the same single pre-existing error from Task 1 (`clientState()` missing `isBot`), nothing new.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/bot.ts apps/server/test/bot.test.ts
git commit -m "Add bot bidding, trump, and card-play heuristics"
```

---

### Task 3: `RoomManager` — bot player model, `addBot`/`removeBot`

**Files:**
- Modify: `apps/server/src/rooms.ts`
- Modify: `apps/server/test/rooms.test.ts`

**Interfaces:**
- Consumes: nothing new (this task doesn't use `bot.ts` yet — that's Task 4).
- Produces: `Player.isBot: boolean`. `RoomManager.addBot(code: string, hostToken: string): { seat: number; name: string }` and `RoomManager.removeBot(code: string, hostToken: string, seat: number): void`. `clientState()`'s player entries now include `isBot`, resolving Task 1's expected typecheck error. Task 4 relies on `Player.isBot` and reuses `MAX_PLAYERS` already imported in this file.

- [ ] **Step 1: Write the failing tests**

Edit `apps/server/test/rooms.test.ts`. Insert a new `describe` block between the end of the `describe('lobby', ...)` block and the start of `describe('public quick match', ...)`:

```ts
describe('lobby bots', () => {
  test('the host can add a bot, which gets a themed name and counts toward the player list', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    const { seat, name } = rooms.addBot(host.code, host.token);
    expect(seat).toBe(1);
    expect(name).toMatch(/^(Golem|Familiar|Homunculus|Specter|Wraith)$/);
    const state = rooms.clientState(host.code, host.token);
    expect(state.players).toHaveLength(2);
    expect(state.players[1]!.isBot).toBe(true);
    expect(state.players[0]!.isBot).toBe(false);
  });

  test('adding several bots gives each a distinct name', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    const names = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { name } = rooms.addBot(host.code, host.token);
      names.add(name);
    }
    expect(names.size).toBe(5);
  });

  test('only the host can add or remove a bot', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    const bob = rooms.join(host.code, 'Bob');
    expect(() => rooms.addBot(host.code, bob.token)).toThrow(/host/i);
    rooms.addBot(host.code, host.token);
    expect(() => rooms.removeBot(host.code, bob.token, 2)).toThrow(/host/i);
  });

  test('a bot cannot be added once the room is full', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    for (let i = 0; i < 5; i++) rooms.addBot(host.code, host.token);
    expect(() => rooms.addBot(host.code, host.token)).toThrow(/full/i);
  });

  test('a bot cannot be added or removed once the game has started', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    rooms.addBot(host.code, host.token);
    rooms.join(host.code, 'Bob');
    rooms.start(host.code, host.token);
    expect(() => rooms.addBot(host.code, host.token)).toThrow(/started/i);
    expect(() => rooms.removeBot(host.code, host.token, 1)).toThrow(/started/i);
  });

  test('removing a bot frees its seat; removing a non-bot seat is rejected', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    rooms.addBot(host.code, host.token);
    rooms.removeBot(host.code, host.token, 1);
    expect(rooms.clientState(host.code, host.token).players).toHaveLength(1);
    expect(() => rooms.removeBot(host.code, host.token, 0)).toThrow(/bot/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/server/test/rooms.test.ts -t "lobby bots"`
Expected: FAIL — `rooms.addBot is not a function`.

- [ ] **Step 3: Add `isBot` to the `Player` interface**

Edit `apps/server/src/rooms.ts`. Replace:

```ts
interface Player {
  name: string;
  token: string;
  connected: boolean;
  lastEmoteAt: number;
}
```

with:

```ts
interface Player {
  name: string;
  token: string;
  connected: boolean;
  lastEmoteAt: number;
  isBot: boolean;
}
```

- [ ] **Step 4: Add `isBot: false` to the four existing human player-construction sites**

In `create()`, replace:

```ts
      players: [{ name: sanitizeName(name), token, connected: true, lastEmoteAt: 0 }],
```

with:

```ts
      players: [{ name: sanitizeName(name), token, connected: true, lastEmoteAt: 0, isBot: false }],
```

In `quickMatch()`'s first branch (joining an existing public room), replace:

```ts
        room.players.push({ name: clean, token, connected: true, lastEmoteAt: 0 });
```

with:

```ts
        room.players.push({ name: clean, token, connected: true, lastEmoteAt: 0, isBot: false });
```

In `quickMatch()`'s second branch (opening a new public room), replace:

```ts
      players: [{ name: clean, token, connected: true, lastEmoteAt: 0 }],
```

with:

```ts
      players: [{ name: clean, token, connected: true, lastEmoteAt: 0, isBot: false }],
```

In `join()`, replace:

```ts
    room.players.push({
      name: sanitizeName(name),
      token: newToken,
      connected: true,
      lastEmoteAt: 0,
    });
```

with:

```ts
    room.players.push({
      name: sanitizeName(name),
      token: newToken,
      connected: true,
      lastEmoteAt: 0,
      isBot: false,
    });
```

- [ ] **Step 5: Add `isBot` to `clientState()`'s player mapping**

Replace:

```ts
      players: room.players.map((p, i) => ({
        name: p.name,
        connected: p.connected,
        isHost: i === 0,
        handCount: game?.hands[i]?.length ?? 0,
        bid: game?.bids[i] ?? null,
        tricksWon: game?.tricksWon[i] ?? 0,
        score: game?.scores[i] ?? 0,
      })),
```

with:

```ts
      players: room.players.map((p, i) => ({
        name: p.name,
        connected: p.connected,
        isHost: i === 0,
        isBot: p.isBot,
        handCount: game?.hands[i]?.length ?? 0,
        bid: game?.bids[i] ?? null,
        tricksWon: game?.tricksWon[i] ?? 0,
        score: game?.scores[i] ?? 0,
      })),
```

- [ ] **Step 6: Add the bot name pool constant**

Near the top of the file, right after the existing `PUBLIC_AUTO_START_DELAY_MS` constant, add:

```ts
/** Themed bot names, assigned in this order; falls back to "Bot N" if exhausted. */
const BOT_NAMES = ['Golem', 'Familiar', 'Homunculus', 'Specter', 'Wraith'];
```

- [ ] **Step 7: Add `addBot`/`removeBot` and the `nextBotName` helper**

Right after the `leave()` method (and before `start()`), add:

```ts
  /** Fill an empty seat with an AI-controlled player. Host-only, lobby-only. */
  addBot(code: string, hostToken: string): { seat: number; name: string } {
    const room = this.room(code);
    if (this.seat(room, hostToken) !== 0) throw new GameError('not_host', 'Only the host can add a bot');
    if (room.game) throw new GameError('already_started', 'You cannot add a bot once the game has started');
    if (room.players.length >= MAX_PLAYERS) throw new GameError('room_full', 'This room is full');
    const name = this.nextBotName(room);
    const token = randomBytes(16).toString('hex');
    room.players.push({ name, token, connected: true, lastEmoteAt: 0, isBot: true });
    room.lastActivity = Date.now();
    return { seat: room.players.length - 1, name };
  }

  /** Remove a bot from its seat. Host-only, lobby-only. */
  removeBot(code: string, hostToken: string, seat: number): void {
    const room = this.room(code);
    if (this.seat(room, hostToken) !== 0) {
      throw new GameError('not_host', 'Only the host can remove a bot');
    }
    if (room.game) {
      throw new GameError('already_started', 'You cannot remove a bot once the game has started');
    }
    const target = room.players[seat];
    if (!target?.isBot) throw new GameError('not_a_bot', 'That seat is not a bot');
    room.players.splice(seat, 1);
    room.lastActivity = Date.now();
  }
```

Then, among the other `private` helpers near the bottom of the class (next to `recomputePublicAutoStart`), add:

```ts
  /** The next unused themed bot name, or a numbered fallback once the pool is exhausted. */
  private nextBotName(room: Room): string {
    const used = new Set(room.players.map((p) => p.name));
    const free = BOT_NAMES.find((n) => !used.has(n));
    if (free) return free;
    let i = 1;
    while (used.has(`Bot ${i}`)) i++;
    return `Bot ${i}`;
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run apps/server/test/rooms.test.ts`
Expected: PASS, all tests in the file (the pre-existing ones plus the new `lobby bots` block).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: no output, exit code 0 (Task 1's expected error is now resolved).

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/rooms.ts apps/server/test/rooms.test.ts
git commit -m "Add RoomManager.addBot/removeBot and the bot player model"
```

---

### Task 4: `RoomManager` — bots take their own turns

**Files:**
- Modify: `apps/server/src/rooms.ts`
- Modify: `apps/server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `chooseBotBid`, `chooseBotTrump`, `chooseBotCard` from `./bot` (Task 2). `Player.isBot` (Task 3).
- Produces: `RoomManager.pendingBotSeat(code: string): number | null` and `RoomManager.playBotTurn(code: string): boolean`. Task 5 (`apps/server/src/app.ts`) calls both of these to schedule and perform bot moves.

- [ ] **Step 1: Write the failing tests**

Edit `apps/server/test/rooms.test.ts`. Add a new `describe` block right after the `describe('lobby bots', ...)` block added in Task 3 (before `describe('public quick match', ...)`):

```ts
describe('bots take their own turns', () => {
  /** Drive one round to completion: the human host bids 0/plays first-legal, bots via playBotTurn. */
  function playRoundWithBots(rooms: RoomManager, code: string, hostToken: string): void {
    let snap = rooms.clientState(code, hostToken);
    while (snap.phase !== 'roundEnd' && snap.phase !== 'gameOver') {
      if (rooms.playBotTurn(code)) {
        snap = rooms.clientState(code, hostToken);
        continue;
      }
      if (snap.phase === 'choosingTrump') {
        rooms.chooseTrump(code, hostToken, 'red');
      } else if (snap.phase === 'bidding') {
        rooms.bid(code, hostToken, 0);
      } else if (snap.phase === 'playing') {
        rooms.play(code, hostToken, snap.legalIds[0]!);
      }
      snap = rooms.clientState(code, hostToken);
    }
  }

  test('pendingBotSeat identifies the bot whose turn it is, and stays null on the lobby/human turns', () => {
    const rooms = new RoomManager(seededRng(11));
    const host = rooms.create('Ana');
    rooms.addBot(host.code, host.token);
    expect(rooms.pendingBotSeat(host.code)).toBeNull(); // still in lobby
    rooms.start(host.code, host.token);
    const state = rooms.clientState(host.code, host.token);
    if (state.phase === 'choosingTrump') {
      // round 1's dealer is always the human host (seat 0), never a bot
      expect(rooms.pendingBotSeat(host.code)).toBeNull();
      rooms.chooseTrump(host.code, host.token, 'red');
    }
    // bidding always starts left of the dealer: seat 1, the bot
    expect(rooms.pendingBotSeat(host.code)).toBe(1);
  });

  test('playBotTurn resolves the pending bot action and returns false once nothing is pending', () => {
    const rooms = new RoomManager(seededRng(11));
    const host = rooms.create('Ana');
    expect(rooms.playBotTurn(host.code)).toBe(false); // lobby: nothing pending
    rooms.addBot(host.code, host.token);
    rooms.join(host.code, 'Bob');
    rooms.start(host.code, host.token);
    const state = rooms.clientState(host.code, host.token);
    if (state.phase === 'choosingTrump') rooms.chooseTrump(host.code, host.token, 'red');
    // bidding: seat 1 (bot) goes first, seat 2 (Bob, human) goes second
    expect(rooms.playBotTurn(host.code)).toBe(true);
    expect(rooms.pendingBotSeat(host.code)).toBeNull(); // Bob's turn now, not a bot's
    expect(rooms.playBotTurn(host.code)).toBe(false); // no-op: nothing bot-pending
  });

  test('a full game with 2 bots completes without any bot ever attempting an illegal move', () => {
    const rooms = new RoomManager(seededRng(11));
    const host = rooms.create('Ana');
    rooms.addBot(host.code, host.token);
    rooms.addBot(host.code, host.token);
    rooms.start(host.code, host.token);

    expect(() => {
      for (let round = 1; round <= 20; round++) {
        playRoundWithBots(rooms, host.code, host.token);
        if (round < 20) rooms.advance(host.code);
      }
    }).not.toThrow();

    expect(rooms.stats().completedGames).toBe(1);
    expect(rooms.clientState(host.code, host.token).phase).toBe('gameOver');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/server/test/rooms.test.ts -t "bots take their own turns"`
Expected: FAIL — `rooms.pendingBotSeat is not a function`.

- [ ] **Step 3: Add the `./bot` import**

At the top of `apps/server/src/rooms.ts`, add a new import line right after the existing `@wizard/shared` import block:

```ts
import { chooseBotBid, chooseBotCard, chooseBotTrump } from './bot';
```

- [ ] **Step 4: Split `applyIntent` into a token-resolving wrapper and a seat-based core**

Replace the existing private `applyIntent` method:

```ts
  private applyIntent(
    code: string,
    token: string,
    fn: (game: GameState, seat: number) => GameState,
  ): void {
    const room = this.room(code);
    const seat = this.seat(room, token);
    if (!room.game) throw new GameError('no_game', 'The game has not started');
    room.game = fn(room.game, seat);
    room.lastActivity = Date.now();
  }
```

with:

```ts
  /** Apply a game action at a known seat — the core both token-based and bot-driven paths share. */
  private applyIntentAtSeat(
    room: Room,
    seat: number,
    fn: (game: GameState, seat: number) => GameState,
  ): void {
    if (!room.game) throw new GameError('no_game', 'The game has not started');
    room.game = fn(room.game, seat);
    room.lastActivity = Date.now();
  }

  private applyIntent(
    code: string,
    token: string,
    fn: (game: GameState, seat: number) => GameState,
  ): void {
    const room = this.room(code);
    const seat = this.seat(room, token);
    this.applyIntentAtSeat(room, seat, fn);
  }
```

- [ ] **Step 5: Update `play()` to resolve its own seat**

Replace:

```ts
  play(code: string, token: string, cardId: string): void {
    const room = this.room(code);
    const wasOver = room.game?.phase === 'gameOver';
    this.applyIntent(code, token, (game, seat) => playCard(game, seat, cardId));
    if (!wasOver && room.game?.phase === 'gameOver') this.completedGames++;
  }
```

with:

```ts
  play(code: string, token: string, cardId: string): void {
    const room = this.room(code);
    const seat = this.seat(room, token);
    const wasOver = room.game?.phase === 'gameOver';
    this.applyIntentAtSeat(room, seat, (game, s) => playCard(game, s, cardId));
    if (!wasOver && room.game?.phase === 'gameOver') this.completedGames++;
  }
```

- [ ] **Step 6: Add `pendingActor`, `pendingBotSeat`, and `playBotTurn`**

Right after the existing `startIfDue()` method, add:

```ts
  /** The bot seat currently awaited, if any — used to decide whether to schedule a bot move. */
  pendingBotSeat(code: string): number | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    const actor = this.pendingActor(room);
    if (!actor) return null;
    return room.players[actor.seat]?.isBot ? actor.seat : null;
  }

  /** Compute and apply the pending bot's decision, if any. Returns whether it did. */
  playBotTurn(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    const actor = this.pendingActor(room);
    if (!actor || !room.players[actor.seat]?.isBot) return false;
    const game = room.game!;
    switch (actor.kind) {
      case 'chooseTrump':
        this.applyIntentAtSeat(room, actor.seat, (g, seat) =>
          chooseTrump(g, seat, chooseBotTrump(g, seat)),
        );
        break;
      case 'bid':
        this.applyIntentAtSeat(room, actor.seat, (g, seat) => placeBid(g, seat, chooseBotBid(g, seat)));
        break;
      case 'play': {
        const wasOver = game.phase === 'gameOver';
        this.applyIntentAtSeat(room, actor.seat, (g, seat) => playCard(g, seat, chooseBotCard(g, seat)));
        if (!wasOver && room.game?.phase === 'gameOver') this.completedGames++;
        break;
      }
    }
    return true;
  }
```

Then, among the other `private` helpers near `recomputePublicAutoStart`, add:

```ts
  /**
   * The seat whose action is currently awaited (dealer for choosingTrump,
   * turnIndex otherwise), or null if the game isn't running or the phase
   * needs no seat action (roundEnd/gameOver).
   */
  private pendingActor(room: Room): { seat: number; kind: 'chooseTrump' | 'bid' | 'play' } | null {
    const game = room.game;
    if (!game) return null;
    switch (game.phase) {
      case 'choosingTrump':
        return { seat: game.dealerIndex, kind: 'chooseTrump' };
      case 'bidding':
        return { seat: game.turnIndex, kind: 'bid' };
      case 'playing':
        return { seat: game.turnIndex, kind: 'play' };
      default:
        return null;
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run apps/server/test/rooms.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/rooms.ts apps/server/test/rooms.test.ts
git commit -m "Let bots take their own bid/trump/play turns"
```

---

### Task 5: Server wiring — `room:addBot`/`room:removeBot` handlers and the bot-turn scheduler

**Files:**
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `rooms.addBot`, `rooms.removeBot`, `rooms.pendingBotSeat`, `rooms.playBotTurn` (Tasks 3–4). The `'room:addBot'`/`'room:removeBot'` protocol events (Task 1).
- Produces: a running server that adds/removes bots over sockets and automatically advances bot turns. Task 6 (the client) calls these two new events.

- [ ] **Step 1: Add the bot delay constants**

Replace:

```ts
const ROUND_END_DELAY_MS = 7000;
```

with:

```ts
const ROUND_END_DELAY_MS = 7000;
const BOT_MIN_DELAY_MS = 700;
const BOT_MAX_DELAY_MS = 1800;
```

- [ ] **Step 2: Add the `botTimers` map and its cleanup**

Replace:

```ts
  const roundTimers = new Map<string, NodeJS.Timeout>();
  const publicStartTimers = new Map<string, NodeJS.Timeout>();
```

with:

```ts
  const roundTimers = new Map<string, NodeJS.Timeout>();
  const publicStartTimers = new Map<string, NodeJS.Timeout>();
  const botTimers = new Map<string, NodeJS.Timeout>();
```

Replace:

```ts
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    for (const timer of roundTimers.values()) clearTimeout(timer);
    for (const timer of publicStartTimers.values()) clearTimeout(timer);
    await io.close();
  });
```

with:

```ts
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    for (const timer of roundTimers.values()) clearTimeout(timer);
    for (const timer of publicStartTimers.values()) clearTimeout(timer);
    for (const timer of botTimers.values()) clearTimeout(timer);
    await io.close();
  });
```

Note: this hook currently appears *before* `roundTimers`/`publicStartTimers`/`botTimers` are declared further down the file (they're `const`, hoisted to the top of the temporal-dead-zone but not usable before their own declaration line — however, the hook is a callback that only *runs* later, after `buildServer()` has finished executing and all three `const` declarations have already run, so referencing them here is safe). This matches the existing pattern already in the file — no reordering needed.

- [ ] **Step 3: Add `scheduleBotTurn` and call it from `broadcast`**

Replace:

```ts
  /** Push each connected socket in the room its own redacted snapshot. */
  async function broadcast(code: string): Promise<void> {
    if (!rooms.has(code)) return;
    const sockets = await io.in(code).fetchSockets();
    for (const socket of sockets) {
      const { token } = socket.data as { token?: string };
      if (!token) continue;
      try {
        socket.emit('state' satisfies keyof ServerToClientEvents, rooms.clientState(code, token));
      } catch {
        // player no longer in the room (left lobby); ignore
      }
    }
  }
```

with:

```ts
  /** Push each connected socket in the room its own redacted snapshot. */
  async function broadcast(code: string): Promise<void> {
    if (!rooms.has(code)) return;
    const sockets = await io.in(code).fetchSockets();
    for (const socket of sockets) {
      const { token } = socket.data as { token?: string };
      if (!token) continue;
      try {
        socket.emit('state' satisfies keyof ServerToClientEvents, rooms.clientState(code, token));
      } catch {
        // player no longer in the room (left lobby); ignore
      }
    }
    scheduleBotTurn(code);
  }

  /** (Re)arm the timer that lets a pending bot take its turn after a short "thinking" delay. */
  function scheduleBotTurn(code: string): void {
    clearTimeout(botTimers.get(code));
    botTimers.delete(code);
    if (rooms.pendingBotSeat(code) === null) return;
    const delay = BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
    botTimers.set(
      code,
      setTimeout(() => {
        botTimers.delete(code);
        try {
          if (rooms.playBotTurn(code)) void broadcast(code);
        } catch (err) {
          app.log.error({ err, code }, "bot failed to take its turn");
        }
      }, delay),
    );
  }
```

- [ ] **Step 4: Add the `room:addBot`/`room:removeBot` socket handlers**

Replace:

```ts
    socket.on('room:start', intent((code, token) => rooms.start(code, token)));
    socket.on('room:again', intent((code, token) => rooms.again(code, token)));
```

with:

```ts
    socket.on('room:start', intent((code, token) => rooms.start(code, token)));
    socket.on('room:again', intent((code, token) => rooms.again(code, token)));

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

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (the pre-existing suite plus everything added in Tasks 2–4).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "Wire room:addBot/removeBot and schedule bot turns after every broadcast"
```

---

### Task 6: Client — add/remove bots in the lobby, bot tags in the lobby and in-game

**Files:**
- Modify: `apps/web/src/socket.ts`
- Modify: `apps/web/src/screens/Lobby.tsx`
- Modify: `apps/web/src/screens/Game.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `room:addBot`/`room:removeBot` (Task 5), `PublicPlayer.isBot` (Task 1, already flowing through `ClientState.players[i].isBot`).
- Produces: end of the chain — nothing else consumes this.

- [ ] **Step 1: Add `addBot`/`removeBot` to the socket API**

Edit `apps/web/src/socket.ts`. Replace:

```ts
  again: () => ask((cb) => socket.emit('room:again', cb)),
  chooseTrump: (suit: Suit) => ask((cb) => socket.emit('game:chooseTrump', { suit }, cb)),
```

with:

```ts
  again: () => ask((cb) => socket.emit('room:again', cb)),
  addBot: () => ask<{ seat: number; name: string }>((cb) => socket.emit('room:addBot', cb)),
  removeBot: (seat: number) => ask((cb) => socket.emit('room:removeBot', { seat }, cb)),
  chooseTrump: (suit: Suit) => ask((cb) => socket.emit('game:chooseTrump', { suit }, cb)),
```

- [ ] **Step 2: Add bot controls to the Lobby screen**

Edit `apps/web/src/screens/Lobby.tsx`. Replace the component signature:

```tsx
export function Lobby({
  state,
  onStart,
  onLeave,
}: {
  state: ClientState;
  onStart: () => void;
  onLeave: () => void;
}) {
```

with:

```tsx
export function Lobby({
  state,
  onStart,
  onLeave,
  onAddBot,
  onRemoveBot,
}: {
  state: ClientState;
  onStart: () => void;
  onLeave: () => void;
  onAddBot: () => void;
  onRemoveBot: (seat: number) => void;
}) {
```

Replace the seats list and its surrounding section:

```tsx
      <section className="panel lobby__seats">
        <h2 className="panel__title">Seated ({state.players.length}/6)</h2>
        <ul className="lobby__list">
          {state.players.map((p, i) => (
            <li key={i} className={`lobby__player ${p.connected ? '' : 'lobby__player--away'}`}>
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">
                {p.name}
                {i === state.seat ? ' (you)' : ''}
              </span>
              {p.isHost && <span className="tag">host</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 3 - state.players.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="lobby__player lobby__player--empty">
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">waiting…</span>
            </li>
          ))}
        </ul>
      </section>
```

with:

```tsx
      <section className="panel lobby__seats">
        <h2 className="panel__title">Seated ({state.players.length}/6)</h2>
        <ul className="lobby__list">
          {state.players.map((p, i) => (
            <li key={i} className={`lobby__player ${p.connected ? '' : 'lobby__player--away'}`}>
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">
                {p.name}
                {i === state.seat ? ' (you)' : ''}
              </span>
              {p.isHost && <span className="tag">host</span>}
              {p.isBot && <span className="tag">bot</span>}
              {isHost && p.isBot && (
                <button
                  type="button"
                  className="lobby__removebot"
                  onClick={() => onRemoveBot(i)}
                  aria-label={`Remove ${p.name}`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 3 - state.players.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="lobby__player lobby__player--empty">
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">waiting…</span>
            </li>
          ))}
        </ul>
        {isHost && state.players.length < 6 && (
          <button type="button" className="btn btn--ghost btn--small" onClick={onAddBot}>
            Add a bot
          </button>
        )}
      </section>
```

- [ ] **Step 3: Add the bot tag to in-game seat chips**

Edit `apps/web/src/screens/Game.tsx`. Replace:

```tsx
              <span className="seatchip__name">
                {p.name}
                {state.dealerIndex === i && <span className="seatchip__dealer" title="Dealer">✦</span>}
              </span>
```

with:

```tsx
              <span className="seatchip__name">
                {p.name}
                {state.dealerIndex === i && <span className="seatchip__dealer" title="Dealer">✦</span>}
                {p.isBot && <span className="tag">bot</span>}
              </span>
```

- [ ] **Step 4: Wire the new Lobby props in `App.tsx`**

Edit `apps/web/src/App.tsx`. Replace:

```tsx
  } else if (state.phase === 'lobby') {
    screen = <Lobby state={state} onStart={() => act(api.start)} onLeave={leaveRoom} />;
```

with:

```tsx
  } else if (state.phase === 'lobby') {
    screen = (
      <Lobby
        state={state}
        onStart={() => act(api.start)}
        onLeave={leaveRoom}
        onAddBot={() => act(api.addBot)}
        onRemoveBot={(seat) => act(() => api.removeBot(seat))}
      />
    );
```

- [ ] **Step 5: Style the remove-bot control**

Edit `apps/web/src/styles.css`. Replace:

```css
.lobby__name { flex: 1; text-align: left; }
```

with:

```css
.lobby__name { flex: 1; text-align: left; }

.lobby__removebot {
  color: var(--text-dim);
  font-size: 0.85rem;
  padding: 2px 6px;
  line-height: 1;
}
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no output, exit code 0.

Run: `npm run build`
Expected: all three workspace builds succeed.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass (this feature adds no new frontend automated tests — no frontend test framework is configured in this repo, consistent with prior client-side features).

- [ ] **Step 8: Manual verification**

Start the server and web dev servers per the project README, open the app, create a table, and:
1. Confirm an "Add a bot" button appears for the host, and it's absent for a joined non-host player.
2. Add 2 bots; confirm each gets a distinct themed name and a "bot" tag, and the seated count updates.
3. Confirm the remove (✕) control appears next to each bot for the host, and removing one frees the seat.
4. Add enough bots to start (2 bots + you), start the game, and watch it play: confirm bots bid, choose trump when dealer, and play cards with a short visible delay (not instantly), and that the game reaches `roundEnd`/next round without stalling.
5. Confirm the "Add a bot" button disappears once the room hits 6/6 seated.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/socket.ts apps/web/src/screens/Lobby.tsx apps/web/src/screens/Game.tsx apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "Add bot controls and bot tags to the lobby and game screens"
```
