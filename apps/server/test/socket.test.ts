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
});
