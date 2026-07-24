import { describe, expect, test } from 'vitest';
import { RoomManager } from '../src/rooms';

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

function threePlayerRoom(rooms: RoomManager) {
  const host = rooms.create('Ana');
  const bob = rooms.join(host.code, 'Bob');
  const cy = rooms.join(host.code, 'Cy');
  return { code: host.code, tokens: [host.token, bob.token, cy.token] };
}

describe('lobby', () => {
  test('create returns a 4-letter code and joining adds players in seat order', () => {
    const rooms = new RoomManager(seededRng(1));
    const { code, token } = rooms.create('Ana');
    expect(code).toMatch(/^[A-Z]{4}$/);
    rooms.join(code, 'Bob');
    const state = rooms.clientState(code, token);
    expect(state.phase).toBe('lobby');
    expect(state.players.map((p) => p.name)).toEqual(['Ana', 'Bob']);
    expect(state.players[0]!.isHost).toBe(true);
    expect(state.seat).toBe(0);
  });

  test('joining an unknown room fails', () => {
    const rooms = new RoomManager(seededRng(1));
    expect(() => rooms.join('XXXX', 'Bob')).toThrow(/room/i);
  });

  test('room is capped at 6 players', () => {
    const rooms = new RoomManager(seededRng(1));
    const { code } = rooms.create('P0');
    for (let i = 1; i < 6; i++) rooms.join(code, `P${i}`);
    expect(() => rooms.join(code, 'P6')).toThrow(/full/i);
  });

  test('only the host can start, and only with 3+ players', () => {
    const rooms = new RoomManager(seededRng(1));
    const host = rooms.create('Ana');
    const bob = rooms.join(host.code, 'Bob');
    expect(() => rooms.start(host.code, host.token)).toThrow(/players/i);
    rooms.join(host.code, 'Cy');
    expect(() => rooms.start(host.code, bob.token)).toThrow(/host/i);
    rooms.start(host.code, host.token);
    expect(rooms.clientState(host.code, host.token).phase).not.toBe('lobby');
  });

  test('leaving the lobby frees the seat; joining after start is rejected', () => {
    const rooms = new RoomManager(seededRng(1));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.leave(code, tokens[1]!);
    expect(rooms.clientState(code, tokens[0]!).players.map((p) => p.name)).toEqual(['Ana', 'Cy']);
    rooms.join(code, 'Dee');
    rooms.start(code, tokens[0]!);
    expect(() => rooms.join(code, 'Late')).toThrow(/started/i);
  });
});

describe('game play and redaction', () => {
  test('each player sees only their own hand; others are counts', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    const s0 = rooms.clientState(code, tokens[0]!);
    const s1 = rooms.clientState(code, tokens[1]!);
    expect(s0.hand).toHaveLength(1);
    expect(s1.hand).toHaveLength(1);
    expect(s0.hand[0]!.id).not.toBe(s1.hand[0]!.id);
    expect(s0.players.map((p) => p.handCount)).toEqual([1, 1, 1]);
    expect(s0.seat).toBe(0);
    expect(s1.seat).toBe(1);
  });

  test('intents flow through: trump choice, bids, plays, scoring', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);

    let state = rooms.clientState(code, tokens[0]!);
    if (state.phase === 'choosingTrump') {
      rooms.chooseTrump(code, tokens[state.dealerIndex]!, 'red');
      state = rooms.clientState(code, tokens[0]!);
    }
    expect(state.phase).toBe('bidding');
    for (let i = 0; i < 3; i++) {
      const turn = rooms.clientState(code, tokens[0]!).turnIndex;
      rooms.bid(code, tokens[turn]!, 0);
    }
    for (let i = 0; i < 3; i++) {
      const snap = rooms.clientState(code, tokens[0]!);
      if (snap.phase !== 'playing') break;
      const turnSnap = rooms.clientState(code, tokens[snap.turnIndex]!);
      expect(turnSnap.legalIds.length).toBeGreaterThan(0);
      rooms.play(code, tokens[snap.turnIndex]!, turnSnap.legalIds[0]!);
    }
    const done = rooms.clientState(code, tokens[0]!);
    expect(done.phase).toBe('roundEnd');
    expect(done.history).toHaveLength(1);
  });

  test('legalIds is empty when it is not your turn', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    let state = rooms.clientState(code, tokens[0]!);
    if (state.phase === 'choosingTrump') {
      rooms.chooseTrump(code, tokens[state.dealerIndex]!, 'red');
    }
    for (let i = 0; i < 3; i++) {
      const turn = rooms.clientState(code, tokens[0]!).turnIndex;
      rooms.bid(code, tokens[turn]!, 0);
    }
    state = rooms.clientState(code, tokens[0]!);
    const notTurn = (state.turnIndex + 1) % 3;
    expect(rooms.clientState(code, tokens[notTurn]!).legalIds).toEqual([]);
  });

  test('wrong token is rejected', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    expect(() => rooms.clientState(code, 'bogus')).toThrow(/token|player/i);
  });

  test('connection flags flip on disconnect and rejoin keeps the seat', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    rooms.setConnected(code, tokens[1]!, false);
    expect(rooms.clientState(code, tokens[0]!).players[1]!.connected).toBe(false);
    // rejoin with token restores the same seat even mid-game
    const rejoined = rooms.join(code, undefined, tokens[1]!);
    expect(rejoined.token).toBe(tokens[1]!);
    const state = rooms.clientState(code, tokens[1]!);
    expect(state.seat).toBe(1);
    expect(state.players[1]!.connected).toBe(true);
  });

  test('roundEnd advances to the next round via advance()', () => {
    const rooms = new RoomManager(seededRng(2));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    let state = rooms.clientState(code, tokens[0]!);
    if (state.phase === 'choosingTrump') rooms.chooseTrump(code, tokens[state.dealerIndex]!, 'red');
    for (let i = 0; i < 3; i++) {
      const turn = rooms.clientState(code, tokens[0]!).turnIndex;
      rooms.bid(code, tokens[turn]!, 0);
    }
    while (rooms.clientState(code, tokens[0]!).phase === 'playing') {
      const snap = rooms.clientState(code, tokens[0]!);
      const turnSnap = rooms.clientState(code, tokens[snap.turnIndex]!);
      rooms.play(code, tokens[snap.turnIndex]!, turnSnap.legalIds[0]!);
    }
    rooms.advance(code);
    const next = rooms.clientState(code, tokens[0]!);
    expect(next.round).toBe(2);
    expect(next.hand).toHaveLength(2);
  });

  test('idle rooms are garbage collected', () => {
    const rooms = new RoomManager(seededRng(3));
    const { code } = rooms.create('Ana');
    rooms.sweep(Date.now() + 3 * 60 * 60 * 1000); // 3h later
    expect(() => rooms.join(code, 'Bob')).toThrow(/room/i);
  });
});
