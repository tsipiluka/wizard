import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { buildServer } from '../src/app';

let close: () => Promise<void>;
let url: string;
const clients: Socket[] = [];

beforeAll(async () => {
  const built = await buildServer();
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const address = built.app.server.address();
  if (typeof address === 'object' && address) url = `http://127.0.0.1:${address.port}`;
  close = async () => {
    await built.app.close();
  };
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await close();
});

function connect(): Socket {
  const socket = io(url, { forceNew: true });
  clients.push(socket);
  return socket;
}

const ask = <T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  ...args: unknown[]
): Promise<T> => new Promise((resolve) => socket.emit(event, ...args, resolve));

describe('socket layer resilience', () => {
  test('malformed emits (missing ack, missing payload, junk) never kill the server', async () => {
    const socket = connect();
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    // no ack callback at all
    socket.emit('room:start');
    socket.emit('game:play', { cardId: 'red-1' });
    // payload omitted so the ack lands in the payload slot
    socket.emit('room:start', () => undefined);
    // junk payloads
    socket.emit('room:create', 42, () => undefined);
    socket.emit('game:bid', { bid: 'NaN' }, () => undefined);

    // give the server a beat to process everything
    await new Promise((r) => setTimeout(r, 150));

    // server must still respond normally
    const reply = await ask<{ ok: boolean; code: string }>(socket, 'room:create', { name: 'Ana' });
    expect(reply.ok).toBe(true);
    expect(reply.code).toMatch(/^[A-Z]{4}$/);
  });

  test('a full scripted lobby flow works over sockets', async () => {
    const host = connect();
    const guest = connect();
    const guestStates: { phase: string; players: { name: string }[] }[] = [];
    guest.on('state', (s) => guestStates.push(s));
    const created = await ask<{ ok: boolean; code: string }>(host, 'room:create', { name: 'Host' });
    expect(created.ok).toBe(true);

    const joined = await ask<{ ok: boolean }>(guest, 'room:join', {
      code: created.code,
      name: 'Guest',
    });
    expect(joined.ok).toBe(true);

    // starting with 2 players must fail cleanly with a typed error
    const started = await ask<{ ok: boolean; code: string }>(host, 'room:start');
    expect(started.ok).toBe(false);
    expect(started.code).toBe('not_enough_players');

    // guests receive lobby state snapshots
    await new Promise((r) => setTimeout(r, 150));
    expect(guestStates.length).toBeGreaterThan(0);
    const state = guestStates[guestStates.length - 1]!;
    expect(state.phase).toBe('lobby');
    expect(state.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
  });

  test('an emote reaches everyone at the table, including the sender', async () => {
    const host = connect();
    const guest = connect();
    const seen: { seat: number; id: string }[] = [];
    const seenByHost: { seat: number; id: string }[] = [];
    guest.on('emote', (e) => seen.push(e));
    host.on('emote', (e) => seenByHost.push(e));

    const created = await ask<{ ok: boolean; code: string }>(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code: created.code, name: 'Guest' });

    const sent = await ask<{ ok: boolean }>(guest, 'game:emote', { id: 'well-played' });
    expect(sent.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toEqual([expect.objectContaining({ seat: 1, id: 'well-played' })]);
    expect(seenByHost).toEqual([expect.objectContaining({ seat: 1, id: 'well-played' })]);

    // immediate repeat is rate limited, and bogus ids are refused
    const spam = await ask<{ ok: boolean; code: string }>(guest, 'game:emote', { id: 'oops' });
    expect(spam).toMatchObject({ ok: false, code: 'emote_cooldown' });
    const bogus = await ask<{ ok: boolean; code: string }>(host, 'game:emote', { id: '<script>' });
    expect(bogus).toMatchObject({ ok: false, code: 'unknown_emote' });
  });

  test('a lingering old socket disconnecting does not mark a reconnected player away', async () => {
    const first = connect();
    const watcher = connect();
    const states: { players: { name: string; connected: boolean }[] }[] = [];
    watcher.on('state', (s) => states.push(s));

    const created = await ask<{ ok: boolean; code: string; token: string }>(first, 'room:create', {
      name: 'Ana',
    });
    await ask(watcher, 'room:join', { code: created.code, name: 'Watcher' });

    // the phone reconnects on a new socket before the server notices the old one
    const second = connect();
    await ask(second, 'room:join', { code: created.code, token: created.token });

    first.disconnect();
    await new Promise((r) => setTimeout(r, 300));

    const latest = states[states.length - 1]!;
    expect(latest.players[0]!.name).toBe('Ana');
    expect(latest.players[0]!.connected).toBe(true);
  });

  test('a claim code moves the seat and kicks the old device', async () => {
    const phone = connect();
    const other = connect();
    const tablet = connect();
    // the claim itself triggers the state broadcast, so listen before redeeming
    const tabletStates: { seat: number; players: { name: string }[] }[] = [];
    tablet.on('state', (s) => tabletStates.push(s));

    const created = await ask<{ ok: boolean; code: string }>(phone, 'room:create', { name: 'Ana' });
    await ask(other, 'room:join', { code: created.code, name: 'Bob' });

    const kicked = new Promise<string>((resolve) => phone.once('kicked', resolve));
    const claim = await ask<{ ok: boolean; claim: string }>(phone, 'seat:claimCode');
    expect(claim.claim).toMatch(/^[A-Z0-9]{6}$/);

    const moved = await ask<{ ok: boolean; code: string; token: string }>(tablet, 'seat:claim', {
      claim: claim.claim,
    });
    expect(moved.ok).toBe(true);
    expect(moved.code).toBe(created.code);
    expect(await kicked).toBe('moved');

    // the tablet now holds the seat and receives state
    await new Promise((r) => setTimeout(r, 150));
    expect(tabletStates.length).toBeGreaterThan(0);
    const state = tabletStates[tabletStates.length - 1]!;
    expect(state.seat).toBe(0);
    expect(state.players[0]!.name).toBe('Ana');

    // and the code cannot be reused
    const replay = await ask<{ ok: boolean; code: string }>(other, 'seat:claim', {
      claim: claim.claim,
    });
    expect(replay).toMatchObject({ ok: false, code: 'bad_claim' });
  });
});

/** Deterministic PRNG (mulberry32-family), same shape used by rooms.test.ts. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlayerView {
  name: string;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  bid: number | null;
}

interface StateView {
  phase: string;
  seat: number;
  round: number;
  dealerIndex: number;
  turnIndex: number;
  legalIds: string[];
  players: PlayerView[];
}

/**
 * Round 1's dealer is always seat 0 (the room creator) and its trick order is
 * fixed (leftOfDealer..), so the human host always plays last there — which is
 * exactly why the roundEnd-stall bug this suite targets was easy to miss by
 * hand. Round 2's dealer rotates to seat 1, so its trick order shifts and a
 * bot can end the round instead. Seed 2 was picked (by offline simulation
 * against the exact same shared-engine + bot logic the server uses,
 * including the 4 rng() ticks RoomManager.create() burns generating the room
 * code before dealing the first round) to deterministically make round 1 end
 * on the host's own play and round 2 end on a bot's play, so this test
 * exercises the exact trigger condition without relying on luck.
 */
describe('bot-triggered round advancement (regression for the roundEnd stall)', () => {
  let seededClose: () => Promise<void>;
  let seededUrl: string;
  const seededClients: Socket[] = [];

  beforeAll(async () => {
    // A dedicated rng, isolated from the global Math.random, so nothing else
    // (socket.io session ids, etc.) can perturb the deterministic sequence
    // this test relies on to force round 2 to end on a bot's play.
    const built = await buildServer(seededRng(2));
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const address = built.app.server.address();
    if (typeof address === 'object' && address) seededUrl = `http://127.0.0.1:${address.port}`;
    seededClose = async () => {
      await built.app.close();
    };
  });

  afterAll(async () => {
    for (const c of seededClients) c.disconnect();
    await seededClose();
  });

  function seededConnect(): Socket {
    const socket = io(seededUrl, { forceNew: true });
    seededClients.push(socket);
    return socket;
  }

  test(
    "a round that ends on a bot's play (not the host's) still advances to the next round",
    async () => {
      const host = seededConnect();
      await new Promise<void>((resolve) => host.on('connect', () => resolve()));

      const created = await ask<{ ok: boolean; code: string }>(host, 'room:create', { name: 'Ana' });
      expect(created.ok).toBe(true);
      await ask(host, 'room:addBot');
      await ask(host, 'room:addBot');
      const started = await ask<{ ok: boolean }>(host, 'room:start');
      expect(started.ok).toBe(true);

      const states: StateView[] = [];
      let acting = false;
      let actionError: string | null = null;

      /** The bid the host is barred from (mirrors shared forbiddenBid, using client-visible fields). */
      const forbiddenHostBid = (s: StateView): number | null => {
        if (s.phase !== 'bidding') return null;
        const bids = s.players.map((p) => p.bid);
        const pending = bids.filter((b) => b === null).length;
        if (pending !== 1 || bids[s.seat] !== null) return null;
        const others = bids.reduce((sum: number, b) => sum + (b ?? 0), 0);
        const gap = s.round - others;
        return gap >= 0 && gap <= s.round ? gap : null;
      };

      const maybeAct = async (s: StateView): Promise<void> => {
        if (acting) return;
        if (s.phase === 'choosingTrump' && s.dealerIndex === s.seat) {
          acting = true;
          const res = await ask<{ ok: boolean; code?: string }>(host, 'game:chooseTrump', {
            suit: 'red',
          });
          if (!res.ok) actionError = `chooseTrump failed: ${res.code}`;
          acting = false;
        } else if (s.phase === 'bidding' && s.turnIndex === s.seat) {
          acting = true;
          const forbidden = forbiddenHostBid(s);
          const bid = forbidden === 0 ? 1 : 0;
          const res = await ask<{ ok: boolean; code?: string }>(host, 'game:bid', { bid });
          if (!res.ok) actionError = `bid failed: ${res.code}`;
          acting = false;
        } else if (s.phase === 'playing' && s.turnIndex === s.seat) {
          acting = true;
          const res = await ask<{ ok: boolean; code?: string }>(host, 'game:play', {
            cardId: s.legalIds[0],
          });
          if (!res.ok) actionError = `play failed: ${res.code}`;
          acting = false;
        }
      };

      host.on('state', (s: StateView) => {
        states.push(s);
        void maybeAct(s);
      });

      // let the just-issued room:start's own state broadcast (if any) be picked up
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (actionError) throw new Error(actionError);
        const latest = states[states.length - 1];
        if (latest && latest.round >= 3) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      if (actionError) throw new Error(actionError);
      const latest = states[states.length - 1];
      expect(latest).toBeDefined();
      expect(latest!.round).toBeGreaterThanOrEqual(3);
    },
    50000,
  );
});
