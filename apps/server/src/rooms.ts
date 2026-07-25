import { randomBytes } from 'node:crypto';
import {
  type ClientState,
  EMOTE_COOLDOWN_MS,
  type EmoteId,
  GameError,
  type GameState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Suit,
  advanceRound,
  chooseTrump,
  createGame,
  isEmoteId,
  legalCardIds,
  placeBid,
  playCard,
} from '@wizard/shared';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
/** Long enough to walk to the other device, short enough that a stale photo is useless. */
const CLAIM_TTL_MS = 3 * 60 * 1000;
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (I/O/0/1)

interface Player {
  name: string;
  token: string;
  connected: boolean;
  lastEmoteAt: number;
}

interface Room {
  code: string;
  players: Player[];
  game: GameState | null;
  lastActivity: number;
}

/** An outstanding offer to move one seat to another device. */
interface Claim {
  roomCode: string;
  token: string;
  expiresAt: number;
}

/**
 * Owns all rooms and applies every game intent through the shared engine.
 * Pure of any transport concern; the socket layer only translates events.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private claims = new Map<string, Claim>();

  constructor(private rng: () => number = Math.random) {}

  create(name: string): { code: string; token: string } {
    let code: string;
    do {
      code = Array.from({ length: 4 }, () =>
        String.fromCharCode(65 + Math.floor(this.rng() * 26)),
      ).join('');
    } while (this.rooms.has(code));
    const token = randomBytes(16).toString('hex');
    this.rooms.set(code, {
      code,
      players: [{ name: sanitizeName(name), token, connected: true, lastEmoteAt: 0 }],
      game: null,
      lastActivity: Date.now(),
    });
    return { code, token };
  }

  /** Join a lobby with a name, or rejoin any room (even mid-game) with a token. */
  join(code: string, name?: string, token?: string): { token: string } {
    const room = this.room(code);
    if (token) {
      const player = room.players.find((p) => p.token === token);
      if (player) {
        player.connected = true;
        room.lastActivity = Date.now();
        return { token };
      }
    }
    if (room.game) throw new GameError('already_started', 'This game has already started');
    if (room.players.length >= MAX_PLAYERS) throw new GameError('room_full', 'This room is full');
    if (!name) throw new GameError('name_required', 'A name is required to join');
    const newToken = randomBytes(16).toString('hex');
    room.players.push({
      name: sanitizeName(name),
      token: newToken,
      connected: true,
      lastEmoteAt: 0,
    });
    room.lastActivity = Date.now();
    return { token: newToken };
  }

  leave(code: string, token: string): void {
    const room = this.room(code);
    if (room.game) throw new GameError('already_started', 'You cannot leave a running game');
    room.players = room.players.filter((p) => p.token !== token);
    if (room.players.length === 0) this.rooms.delete(code);
    else room.lastActivity = Date.now();
  }

  start(code: string, token: string): void {
    const room = this.room(code);
    const seat = this.seat(room, token);
    if (seat !== 0) throw new GameError('not_host', 'Only the host can start the game');
    if (room.game) throw new GameError('already_started', 'The game has already started');
    if (room.players.length < MIN_PLAYERS) {
      throw new GameError('not_enough_players', `You need at least ${MIN_PLAYERS} players`);
    }
    room.game = createGame(room.players.length, this.rng);
    room.lastActivity = Date.now();
  }

  /** Reset a finished game back to the lobby, keeping the players. */
  again(code: string, token: string): void {
    const room = this.room(code);
    if (this.seat(room, token) !== 0) throw new GameError('not_host', 'Only the host can restart');
    if (room.game && room.game.phase !== 'gameOver') {
      throw new GameError('not_over', 'The game is still running');
    }
    room.game = null;
    room.lastActivity = Date.now();
  }

  chooseTrump(code: string, token: string, suit: Suit): void {
    this.applyIntent(code, token, (game, seat) => chooseTrump(game, seat, suit));
  }

  bid(code: string, token: string, bid: number): void {
    this.applyIntent(code, token, (game, seat) => placeBid(game, seat, bid));
  }

  play(code: string, token: string, cardId: string): void {
    this.applyIntent(code, token, (game, seat) => playCard(game, seat, cardId));
  }

  /** Move a finished round into the next one. Idempotent-safe to skip if not at roundEnd. */
  advance(code: string): void {
    const room = this.room(code);
    if (room.game?.phase === 'roundEnd') {
      room.game = advanceRound(room.game, this.rng);
      room.lastActivity = Date.now();
    }
  }

  /**
   * Validate and rate-limit an emote. Returns what the room should be told;
   * emotes are events, never part of the game snapshot.
   */
  emote(
    code: string,
    token: string,
    id: string,
    now: number = Date.now(),
  ): { seat: number; id: EmoteId } {
    const room = this.room(code);
    const seat = this.seat(room, token);
    if (!isEmoteId(id)) throw new GameError('unknown_emote', 'Unknown emote');
    const player = room.players[seat]!;
    if (now - player.lastEmoteAt < EMOTE_COOLDOWN_MS) {
      throw new GameError('emote_cooldown', 'Slow down a moment');
    }
    player.lastEmoteAt = now;
    room.lastActivity = now;
    return { seat, id };
  }

  /**
   * Issue a single-use code that moves this seat to another device. The seat's
   * token is only rotated on redemption, so an unused code costs nothing.
   */
  createClaim(code: string, token: string, now: number = Date.now()): {
    code: string;
    expiresAt: number;
  } {
    const room = this.room(code);
    this.seat(room, token); // authorizes: the caller must already hold the seat
    // only one live claim per seat, so an older screenshot stops working
    for (const [key, claim] of this.claims) {
      if (claim.token === token) this.claims.delete(key);
    }
    let claimCode: string;
    do {
      claimCode = Array.from(
        { length: 6 },
        () => CLAIM_ALPHABET[Math.floor(this.rng() * CLAIM_ALPHABET.length)]!,
      ).join('');
    } while (this.claims.has(claimCode));
    const expiresAt = now + CLAIM_TTL_MS;
    this.claims.set(claimCode, { roomCode: room.code, token, expiresAt });
    room.lastActivity = now;
    return { code: claimCode, expiresAt };
  }

  /** Redeem a claim: the seat gets a fresh token and the old device is evicted. */
  redeemClaim(
    claimCode: string,
    now: number = Date.now(),
  ): { roomCode: string; token: string; previousToken: string } {
    const key = String(claimCode ?? '').trim().toUpperCase();
    const claim = this.claims.get(key);
    if (!claim) throw new GameError('bad_claim', 'That transfer code is not valid');
    this.claims.delete(key);
    if (now > claim.expiresAt) throw new GameError('claim_expired', 'That transfer code has expired');

    const room = this.rooms.get(claim.roomCode);
    if (!room) throw new GameError('bad_claim', 'That table no longer exists');
    const player = room.players.find((p) => p.token === claim.token);
    if (!player) throw new GameError('bad_claim', 'That seat is no longer at the table');

    const previousToken = player.token;
    player.token = randomBytes(16).toString('hex');
    player.connected = true;
    room.lastActivity = now;
    return { roomCode: room.code, token: player.token, previousToken };
  }

  setConnected(code: string, token: string, connected: boolean): void {
    const room = this.rooms.get(code);
    const player = room?.players.find((p) => p.token === token);
    if (room && player) {
      player.connected = connected;
      room.lastActivity = Date.now();
      // an empty lobby (not a running game) can be dropped right away
      if (!room.game && room.players.every((p) => !p.connected)) this.rooms.delete(code);
    }
  }

  /** Redacted per-player snapshot: the only view of a game that leaves the server. */
  clientState(code: string, token: string): ClientState {
    const room = this.room(code);
    const seat = this.seat(room, token);
    const game = room.game;
    return {
      code: room.code,
      phase: game?.phase ?? 'lobby',
      seat,
      players: room.players.map((p, i) => ({
        name: p.name,
        connected: p.connected,
        isHost: i === 0,
        handCount: game?.hands[i]?.length ?? 0,
        bid: game?.bids[i] ?? null,
        tricksWon: game?.tricksWon[i] ?? 0,
        score: game?.scores[i] ?? 0,
      })),
      hand: game?.hands[seat] ?? [],
      legalIds:
        game && game.phase === 'playing' && game.turnIndex === seat ? legalCardIds(game, seat) : [],
      round: game?.round ?? 0,
      totalRounds: game?.totalRounds ?? 0,
      dealerIndex: game?.dealerIndex ?? 0,
      turnIndex: game?.turnIndex ?? 0,
      trumpCard: game?.trumpCard ?? null,
      trumpSuit: game?.trumpSuit ?? null,
      currentTrick: game?.currentTrick ?? [],
      lastTrick: game?.lastTrick ?? null,
      history: game?.history ?? [],
    };
  }

  tokens(code: string): string[] {
    return this.room(code).players.map((p) => p.token);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  /** Drop rooms with no activity for ROOM_TTL_MS, plus any orphaned/expired claims. */
  sweep(now: number = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) this.rooms.delete(code);
    }
    for (const [key, claim] of this.claims) {
      if (now > claim.expiresAt || !this.rooms.has(claim.roomCode)) this.claims.delete(key);
    }
  }

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

  private room(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new GameError('no_room', 'Room not found');
    return room;
  }

  private seat(room: Room, token: string): number {
    const seat = room.players.findIndex((p) => p.token === token);
    if (seat === -1) throw new GameError('bad_token', 'Unknown player token');
    return seat;
  }
}

function sanitizeName(name: string): string {
  const clean = name.trim().slice(0, 20);
  if (!clean) throw new GameError('bad_name', 'Name must not be empty');
  return clean;
}
