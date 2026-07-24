import { randomBytes } from 'node:crypto';
import {
  type ClientState,
  GameError,
  type GameState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Suit,
  advanceRound,
  chooseTrump,
  createGame,
  legalCardIds,
  placeBid,
  playCard,
} from '@wizard/shared';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

interface Player {
  name: string;
  token: string;
  connected: boolean;
}

interface Room {
  code: string;
  players: Player[];
  game: GameState | null;
  lastActivity: number;
}

/**
 * Owns all rooms and applies every game intent through the shared engine.
 * Pure of any transport concern; the socket layer only translates events.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();

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
      players: [{ name: sanitizeName(name), token, connected: true }],
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
    room.players.push({ name: sanitizeName(name), token: newToken, connected: true });
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

  /** Drop rooms with no activity for ROOM_TTL_MS. */
  sweep(now: number = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) this.rooms.delete(code);
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
