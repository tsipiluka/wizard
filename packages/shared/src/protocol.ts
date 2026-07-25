import type { EmoteId } from './emotes';
import type { Card, Phase, RoundScore, Suit, TrickPlay } from './index';

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

/** Per-player redacted snapshot: the only thing the server ever sends about a game. */
export interface ClientState {
  code: string;
  phase: 'lobby' | Phase;
  seat: number;
  players: PublicPlayer[];
  hand: Card[];
  /** Card ids you may legally play right now (empty unless it is your turn). */
  legalIds: string[];
  round: number;
  totalRounds: number;
  dealerIndex: number;
  turnIndex: number;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  currentTrick: TrickPlay[];
  lastTrick: { plays: TrickPlay[]; winnerIndex: number } | null;
  history: RoundScore[][];
}

export interface ErrorReply {
  ok: false;
  code: string;
  message: string;
}

export type Reply<T> = ({ ok: true } & T) | ErrorReply;

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, cb: (r: Reply<{ code: string; token: string }>) => void) => void;
  'room:join': (
    payload: { code: string; name?: string; token?: string },
    cb: (r: Reply<{ token: string }>) => void,
  ) => void;
  'room:leave': (cb: (r: Reply<object>) => void) => void;
  'room:start': (cb: (r: Reply<object>) => void) => void;
  'room:again': (cb: (r: Reply<object>) => void) => void;
  'game:chooseTrump': (payload: { suit: Suit }, cb: (r: Reply<object>) => void) => void;
  'game:bid': (payload: { bid: number }, cb: (r: Reply<object>) => void) => void;
  'game:play': (payload: { cardId: string }, cb: (r: Reply<object>) => void) => void;
  'game:emote': (payload: { id: EmoteId }, cb: (r: Reply<object>) => void) => void;
  /** Ask for a single-use code that moves this seat to another device. */
  'seat:claimCode': (cb: (r: Reply<{ claim: string; expiresAt: number }>) => void) => void;
  /** Redeem such a code on the new device. */
  'seat:claim': (
    payload: { claim: string },
    cb: (r: Reply<{ code: string; token: string }>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  state: (state: ClientState) => void;
  /** This device lost the seat — another one claimed it. */
  kicked: (reason: 'moved') => void;
  emote: (payload: { seat: number; id: EmoteId; at: number }) => void;
}
