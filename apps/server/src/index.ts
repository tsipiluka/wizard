import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { GameError } from '@wizard/shared';
import type { ClientToServerEvents, ErrorReply, ServerToClientEvents } from '@wizard/shared';
import { RoomManager } from './rooms';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const ROUND_END_DELAY_MS = 7000;

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = [
  process.env.WEB_DIST,
  path.resolve(here, '../../web/dist'), // dev: apps/server/src -> apps/web/dist
  path.resolve(here, '../web'), // docker: /app/server/index.js -> /app/web
].find((p) => p && existsSync(p));

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/healthz', async () => ({ ok: true }));

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

const rooms = new RoomManager();
setInterval(() => rooms.sweep(), 10 * 60 * 1000).unref();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
  serveClient: false,
  cors: process.env.NODE_ENV === 'development' ? { origin: true } : undefined,
});

const roundTimers = new Map<string, NodeJS.Timeout>();

/** Push each connected socket in the room its own redacted snapshot. */
async function broadcast(code: string): Promise<void> {
  if (!rooms.has(code)) return;
  const sockets = await io.in(code).fetchSockets();
  for (const socket of sockets) {
    const { token } = socket.data as { token?: string };
    if (!token) continue;
    try {
      socket.emit('state', rooms.clientState(code, token));
    } catch {
      // player no longer in the room (left lobby); ignore
    }
  }
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

type Cb = (r: { ok: true } | ErrorReply) => void;

function replyError(cb: (r: ErrorReply) => void, err: unknown): void {
  if (err instanceof GameError) {
    cb({ ok: false, code: err.code, message: err.message });
  } else {
    app.log.error({ err }, 'unexpected error');
    cb({ ok: false, code: 'internal', message: 'Something went wrong' });
  }
}

io.on('connection', (socket) => {
  const data = socket.data as { code?: string; token?: string };

  const enter = (code: string, token: string) => {
    data.code = code;
    data.token = token;
    void socket.join(code);
    void broadcast(code);
  };

  /** Run a game intent, reply via ack, broadcast the new state to the room. */
  const handle = (cb: Cb, fn: () => void) => {
    try {
      if (!data.code || !data.token) throw new GameError('no_room', 'You are not in a room');
      fn();
      cb({ ok: true });
      void broadcast(data.code);
      const phase = rooms.clientState(data.code, data.token).phase;
      if (phase === 'roundEnd') scheduleAdvance(data.code);
    } catch (err) {
      replyError(cb, err);
    }
  };

  socket.on('room:create', ({ name }, cb) => {
    try {
      const { code, token } = rooms.create(String(name ?? ''));
      enter(code, token);
      cb({ ok: true, code, token });
    } catch (err) {
      replyError(cb, err);
    }
  });

  socket.on('room:join', ({ code, name, token }, cb) => {
    try {
      const cleanCode = String(code ?? '').trim().toUpperCase();
      const result = rooms.join(cleanCode, name ? String(name) : undefined, token);
      enter(cleanCode, result.token);
      cb({ ok: true, token: result.token });
    } catch (err) {
      replyError(cb, err);
    }
  });

  socket.on('room:leave', (cb) =>
    handle(cb, () => {
      rooms.leave(data.code!, data.token!);
      void socket.leave(data.code!);
      const left = data.code!;
      data.code = undefined;
      data.token = undefined;
      void broadcast(left);
    }),
  );

  socket.on('room:start', (cb) => handle(cb, () => rooms.start(data.code!, data.token!)));
  socket.on('room:again', (cb) => handle(cb, () => rooms.again(data.code!, data.token!)));
  socket.on('game:chooseTrump', ({ suit }, cb) =>
    handle(cb, () => rooms.chooseTrump(data.code!, data.token!, suit)),
  );
  socket.on('game:bid', ({ bid }, cb) =>
    handle(cb, () => rooms.bid(data.code!, data.token!, Number(bid))),
  );
  socket.on('game:play', ({ cardId }, cb) =>
    handle(cb, () => rooms.play(data.code!, data.token!, String(cardId))),
  );

  socket.on('disconnect', () => {
    if (data.code && data.token) {
      rooms.setConnected(data.code, data.token, false);
      void broadcast(data.code);
    }
  });
});

await app.listen({ port: PORT, host: HOST });
