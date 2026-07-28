import { io, type Socket } from 'socket.io-client';
import type {
  ClientState,
  ClientToServerEvents,
  EmoteId,
  Reply,
  ServerToClientEvents,
  Suit,
} from '@wizard/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: AppSocket = io({ autoConnect: true });

const SESSION_KEY = 'wizard-session';

export interface Session {
  code: string;
  token: string;
  name: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function ask<T>(fn: (cb: (r: Reply<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((r) => {
      if (r.ok) resolve(r as T);
      else reject(new Error(r.message));
    });
  });
}

export const api = {
  create: (name: string) =>
    ask<{ code: string; token: string }>((cb) => socket.emit('room:create', { name }, cb)),
  quickMatch: (name: string) =>
    ask<{ code: string; token: string }>((cb) => socket.emit('room:quickMatch', { name }, cb)),
  join: (code: string, name: string) =>
    ask<{ token: string }>((cb) => socket.emit('room:join', { code, name }, cb)),
  rejoin: (code: string, token: string) =>
    ask<{ token: string }>((cb) => socket.emit('room:join', { code, token }, cb)),
  leave: () => ask((cb) => socket.emit('room:leave', cb)),
  start: () => ask((cb) => socket.emit('room:start', cb)),
  again: () => ask((cb) => socket.emit('room:again', cb)),
  addBot: () => ask<{ seat: number; name: string }>((cb) => socket.emit('room:addBot', cb)),
  removeBot: (seat: number) => ask((cb) => socket.emit('room:removeBot', { seat }, cb)),
  chooseTrump: (suit: Suit) => ask((cb) => socket.emit('game:chooseTrump', { suit }, cb)),
  bid: (bid: number) => ask((cb) => socket.emit('game:bid', { bid }, cb)),
  play: (cardId: string) => ask((cb) => socket.emit('game:play', { cardId }, cb)),
  emote: (id: EmoteId) => ask((cb) => socket.emit('game:emote', { id }, cb)),
  claimCode: () =>
    ask<{ claim: string; expiresAt: number }>((cb) => socket.emit('seat:claimCode', cb)),
  claimSeat: (claim: string) =>
    ask<{ code: string; token: string }>((cb) => socket.emit('seat:claim', { claim }, cb)),
};

export type { ClientState };
