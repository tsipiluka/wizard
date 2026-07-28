import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { GameError } from '@wizard/shared';
import type { ErrorReply, ServerToClientEvents, Suit } from '@wizard/shared';
import { registerAdmin } from './admin';
import { RoomManager } from './rooms';

const ROUND_END_DELAY_MS = 7000;
const BOT_MIN_DELAY_MS = 700;
const BOT_MAX_DELAY_MS = 1800;

type Ack = (r: Record<string, unknown> | ErrorReply) => void;

export interface BuiltServer {
  app: FastifyInstance;
  io: Server;
  rooms: RoomManager;
}

export async function buildServer(rng: () => number = Math.random): Promise<BuiltServer> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/healthz', async () => ({ ok: true }));

  const rooms = new RoomManager(rng);
  registerAdmin(app, rooms, Date.now());

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = [
    process.env.WEB_DIST,
    path.resolve(here, '../../web/dist'), // dev: apps/server/src -> apps/web/dist
    path.resolve(here, '../web'), // docker: /app/server/index.js -> /app/web
  ].find((p) => p && existsSync(p));

  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback for client-side routes
      if (req.raw.method === 'GET' && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  } else {
    app.log.warn('No web dist found; serving API only');
  }

  const sweeper = setInterval(() => rooms.sweep(), 10 * 60 * 1000);
  sweeper.unref();

  const io = new Server(app.server, {
    serveClient: false,
    cors: process.env.NODE_ENV === 'development' ? { origin: true } : undefined,
  });
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    for (const timer of roundTimers.values()) clearTimeout(timer);
    for (const timer of publicStartTimers.values()) clearTimeout(timer);
    for (const timer of botTimers.values()) clearTimeout(timer);
    await io.close();
  });

  const roundTimers = new Map<string, NodeJS.Timeout>();
  const publicStartTimers = new Map<string, NodeJS.Timeout>();
  const botTimers = new Map<string, NodeJS.Timeout>();

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
    if (rooms.phase(code) === 'roundEnd' && !roundTimers.has(code)) scheduleAdvance(code);
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

  /** Evict every socket still holding a superseded seat token. */
  async function kickToken(code: string, token: string): Promise<void> {
    const sockets = await io.in(code).fetchSockets();
    for (const other of sockets) {
      const otherData = other.data as { token?: string };
      if (otherData.token !== token) continue;
      other.emit('kicked' satisfies keyof ServerToClientEvents, 'moved');
      // leaving stops the broadcasts; the stale token itself is already inert,
      // since the room manager no longer recognizes it
      void other.leave(code);
    }
  }

  /** (Re)arm the timer that fires a public lobby's auto-start, per its current deadline. */
  function schedulePublicStart(code: string): void {
    clearTimeout(publicStartTimers.get(code));
    publicStartTimers.delete(code);
    const at = rooms.publicAutoStartAt(code);
    if (at === null) return;
    publicStartTimers.set(
      code,
      setTimeout(
        () => {
          publicStartTimers.delete(code);
          try {
            if (rooms.startIfDue(code)) void broadcast(code);
          } catch (err) {
            app.log.error({ err, code }, 'failed to auto-start public table');
          }
        },
        Math.max(0, at - Date.now()),
      ),
    );
  }

  function scheduleAdvance(code: string): void {
    clearTimeout(roundTimers.get(code));
    roundTimers.set(
      code,
      setTimeout(() => {
        roundTimers.delete(code);
        try {
          rooms.advance(code);
          void broadcast(code);
        } catch (err) {
          app.log.error({ err, code }, 'failed to advance round');
        }
      }, ROUND_END_DELAY_MS),
    );
  }

  function replyError(cb: Ack, err: unknown): void {
    if (err instanceof GameError) {
      cb({ ok: false, code: err.code, message: err.message });
    } else {
      app.log.error({ err }, 'unexpected error');
      cb({ ok: false, code: 'internal', message: 'Something went wrong' });
    }
  }

  io.on('connection', (socket) => {
    const data = socket.data as { code?: string; token?: string };

    /**
     * Normalize whatever a client sent: the ack is the trailing function (or a
     * no-op) and the payload is the first object argument. A malformed emit
     * must never be able to throw outside this wrapper and kill the process.
     */
    const safe =
      (fn: (payload: Record<string, unknown>, cb: Ack) => void) =>
      (...args: unknown[]) => {
        const last = args[args.length - 1];
        const cb: Ack = typeof last === 'function' ? (last as Ack) : () => undefined;
        const first = args[0];
        const payload =
          typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
        try {
          fn(payload, cb);
        } catch (err) {
          replyError(cb, err);
        }
      };

    const enter = (code: string, token: string) => {
      data.code = code;
      data.token = token;
      void socket.join(code);
      void broadcast(code);
    };

    /** Run a game intent, ack it, then broadcast the new state to the room. */
    const intent = (fn: (code: string, token: string) => void) =>
      safe((_payload, cb) => {
        if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
        const code = data.code;
        fn(code, data.token);
        cb({ ok: true });
        void broadcast(code);
      });

    socket.on(
      'room:create',
      safe((payload, cb) => {
        const { code, token } = rooms.create(String(payload.name ?? ''));
        enter(code, token);
        cb({ ok: true, code, token });
      }),
    );

    socket.on(
      'room:quickMatch',
      safe((payload, cb) => {
        const { code, token } = rooms.quickMatch(String(payload.name ?? ''));
        enter(code, token);
        cb({ ok: true, code, token });
        schedulePublicStart(code);
      }),
    );

    socket.on(
      'room:join',
      safe((payload, cb) => {
        const code = String(payload.code ?? '').trim().toUpperCase();
        const token = typeof payload.token === 'string' ? payload.token : undefined;
        const name = payload.name === undefined ? undefined : String(payload.name);
        const result = rooms.join(code, name, token);
        enter(code, result.token);
        cb({ ok: true, token: result.token });
        schedulePublicStart(code);
      }),
    );

    socket.on(
      'room:leave',
      safe((_payload, cb) => {
        if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
        const left = data.code;
        rooms.leave(left, data.token);
        void socket.leave(left);
        data.code = undefined;
        data.token = undefined;
        cb({ ok: true });
        void broadcast(left);
        schedulePublicStart(left);
      }),
    );

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

    socket.on('game:chooseTrump', (...args: unknown[]) => {
      const payload = (typeof args[0] === 'object' && args[0]) || {};
      intent((code, token) =>
        rooms.chooseTrump(code, token, (payload as { suit?: Suit }).suit as Suit),
      )(...args);
    });
    socket.on('game:bid', (...args: unknown[]) => {
      const payload = (typeof args[0] === 'object' && args[0]) || {};
      intent((code, token) =>
        rooms.bid(code, token, Number((payload as { bid?: unknown }).bid)),
      )(...args);
    });
    socket.on('game:play', (...args: unknown[]) => {
      const payload = (typeof args[0] === 'object' && args[0]) || {};
      intent((code, token) =>
        rooms.play(code, token, String((payload as { cardId?: unknown }).cardId)),
      )(...args);
    });

    socket.on(
      'game:emote',
      safe((payload, cb) => {
        if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
        const sent = rooms.emote(data.code, data.token, String(payload.id));
        cb({ ok: true });
        // an event, not state: no snapshot rebroadcast
        io.to(data.code).emit('emote', { ...sent, at: Date.now() });
      }),
    );

    socket.on(
      'seat:claimCode',
      safe((_payload, cb) => {
        if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
        const { code, expiresAt } = rooms.createClaim(data.code, data.token);
        cb({ ok: true, claim: code, expiresAt });
      }),
    );

    socket.on(
      'seat:claim',
      safe((payload, cb) => {
        const { roomCode, token, previousToken } = rooms.redeemClaim(String(payload.claim ?? ''));
        // evict whoever held the seat before, then take it over here
        void kickToken(roomCode, previousToken);
        enter(roomCode, token);
        cb({ ok: true, code: roomCode, token });
      }),
    );

    socket.on('disconnect', () => {
      const { code, token } = data;
      if (!code || !token) return;
      void (async () => {
        // A reconnect can race ahead of the old socket's disconnect. Only mark the
        // seat away when no other live socket still holds this token.
        const others = await io.in(code).fetchSockets();
        const stillHere = others.some(
          (s) => s.id !== socket.id && (s.data as { token?: string }).token === token,
        );
        if (!stillHere) rooms.setConnected(code, token, false);
        await broadcast(code);
      })();
    });
  });

  return { app, io, rooms };
}
