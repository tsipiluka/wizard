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

  test('emotes are broadcast-ready and rate limited per player', () => {
    const rooms = new RoomManager(seededRng(4));
    const { code, tokens } = threePlayerRoom(rooms);
    const t0 = 1_000_000;

    expect(rooms.emote(code, tokens[0]!, 'well-played', t0)).toEqual({ seat: 0, id: 'well-played' });
    // same player again immediately: rejected
    expect(() => rooms.emote(code, tokens[0]!, 'oops', t0 + 100)).toThrow(/slow down|wait/i);
    // a different player is unaffected by someone else's cooldown
    expect(rooms.emote(code, tokens[1]!, 'oops', t0 + 100)).toEqual({ seat: 1, id: 'oops' });
    // after the cooldown elapses the first player may emote again
    expect(rooms.emote(code, tokens[0]!, 'oops', t0 + 5000)).toEqual({ seat: 0, id: 'oops' });
  });

  test('unknown emote ids are rejected', () => {
    const rooms = new RoomManager(seededRng(4));
    const { code, tokens } = threePlayerRoom(rooms);
    expect(() => rooms.emote(code, tokens[0]!, 'not-an-emote', 1)).toThrow(/emote/i);
  });

  test('idle rooms are garbage collected', () => {
    const rooms = new RoomManager(seededRng(3));
    const { code } = rooms.create('Ana');
    rooms.sweep(Date.now() + 3 * 60 * 60 * 1000); // 3h later
    expect(() => rooms.join(code, 'Bob')).toThrow(/room/i);
  });
});

describe('admin stats', () => {
  /** Play the current round to completion: trump (if needed), all-zero bids, first legal card each turn. */
  function playRound(rooms: RoomManager, code: string, tokens: string[]): void {
    let snap = rooms.clientState(code, tokens[0]!);
    if (snap.phase === 'choosingTrump') rooms.chooseTrump(code, tokens[snap.dealerIndex]!, 'red');
    while (rooms.clientState(code, tokens[0]!).phase === 'bidding') {
      const turn = rooms.clientState(code, tokens[0]!).turnIndex;
      rooms.bid(code, tokens[turn]!, 0);
    }
    while (rooms.clientState(code, tokens[0]!).phase === 'playing') {
      const s = rooms.clientState(code, tokens[0]!);
      const turnSnap = rooms.clientState(code, tokens[s.turnIndex]!);
      rooms.play(code, tokens[s.turnIndex]!, turnSnap.legalIds[0]!);
    }
  }

  test('an empty manager reports zero of everything', () => {
    const rooms = new RoomManager(seededRng(9));
    expect(rooms.stats()).toMatchObject({
      activeRooms: 0,
      lobbies: 0,
      activeGames: 0,
      finishedGames: 0,
      connectedPlayers: 0,
      totalPlayers: 0,
      completedGames: 0,
      rooms: [],
    });
  });

  test('counts a lobby, then a started game, correctly', () => {
    const rooms = new RoomManager(seededRng(9));
    const { code, tokens } = threePlayerRoom(rooms);
    expect(rooms.stats()).toMatchObject({
      activeRooms: 1,
      lobbies: 1,
      activeGames: 0,
      totalPlayers: 3,
      connectedPlayers: 3,
    });

    rooms.start(code, tokens[0]!);
    const stats = rooms.stats();
    expect(stats).toMatchObject({ lobbies: 0, activeGames: 1, finishedGames: 0 });
    expect(stats.rooms).toHaveLength(1);
    expect(stats.rooms[0]).toMatchObject({
      code,
      playerCount: 3,
      connectedCount: 3,
      round: 1,
      totalRounds: 20,
    });
  });

  test('a disconnected player lowers connectedPlayers but not totalPlayers', () => {
    const rooms = new RoomManager(seededRng(9));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.setConnected(code, tokens[1]!, false);
    const stats = rooms.stats();
    expect(stats.connectedPlayers).toBe(2);
    expect(stats.totalPlayers).toBe(3);
  });

  test('completedGames increments exactly once when a game reaches gameOver, and resets are not persisted', () => {
    const rooms = new RoomManager(seededRng(10));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    expect(rooms.stats().completedGames).toBe(0);

    for (let round = 1; round <= 20; round++) {
      playRound(rooms, code, tokens);
      if (round < 20) rooms.advance(code);
    }

    const stats = rooms.stats();
    expect(stats.completedGames).toBe(1);
    expect(stats.activeGames).toBe(0);
    expect(stats.finishedGames).toBe(1);

    // a fresh manager (simulating a restart) starts back at zero
    expect(new RoomManager(seededRng(1)).stats().completedGames).toBe(0);
  });
});

describe('moving a seat to another device', () => {
  test('a claim code hands the seat over and rotates the token', () => {
    const rooms = new RoomManager(seededRng(5));
    const { code, tokens } = threePlayerRoom(rooms);
    rooms.start(code, tokens[0]!);
    const before = rooms.clientState(code, tokens[1]!);

    const claim = rooms.createClaim(code, tokens[1]!, 1000);
    expect(claim.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(claim.expiresAt).toBeGreaterThan(1000);

    const redeemed = rooms.redeemClaim(claim.code, 2000);
    expect(redeemed.roomCode).toBe(code);
    expect(redeemed.token).not.toBe(tokens[1]!); // rotated
    expect(redeemed.previousToken).toBe(tokens[1]!); // so the old socket can be kicked

    // the new token owns the same seat, with the same hand
    const after = rooms.clientState(code, redeemed.token);
    expect(after.seat).toBe(1);
    expect(after.hand).toEqual(before.hand);
    expect(after.players[1]!.name).toBe('Bob');

    // the old token is dead
    expect(() => rooms.clientState(code, tokens[1]!)).toThrow(/token|player/i);
  });

  test('a claim code works only once', () => {
    const rooms = new RoomManager(seededRng(5));
    const { code, tokens } = threePlayerRoom(rooms);
    const claim = rooms.createClaim(code, tokens[2]!, 1000);
    rooms.redeemClaim(claim.code, 1500);
    expect(() => rooms.redeemClaim(claim.code, 1600)).toThrow(/code/i);
  });

  test('expired and unknown claim codes are refused', () => {
    const rooms = new RoomManager(seededRng(5));
    const { code, tokens } = threePlayerRoom(rooms);
    const claim = rooms.createClaim(code, tokens[0]!, 1000);
    expect(() => rooms.redeemClaim(claim.code, claim.expiresAt + 1)).toThrow(/expired|code/i);
    expect(() => rooms.redeemClaim('ZZZZZZ', 1200)).toThrow(/code/i);
  });

  test('issuing a new claim invalidates the previous one for that seat', () => {
    const rooms = new RoomManager(seededRng(5));
    const { code, tokens } = threePlayerRoom(rooms);
    const first = rooms.createClaim(code, tokens[0]!, 1000);
    const second = rooms.createClaim(code, tokens[0]!, 1100);
    expect(() => rooms.redeemClaim(first.code, 1200)).toThrow(/code/i);
    expect(rooms.redeemClaim(second.code, 1200).roomCode).toBe(code);
  });

  test('claims of a garbage-collected room cannot be redeemed', () => {
    const rooms = new RoomManager(seededRng(5));
    const { code, tokens } = threePlayerRoom(rooms);
    const claim = rooms.createClaim(code, tokens[0]!, 1000);
    rooms.sweep(Date.now() + 3 * 60 * 60 * 1000);
    expect(() => rooms.redeemClaim(claim.code, 1200)).toThrow(/code|room/i);
  });
});
