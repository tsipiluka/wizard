import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RoomManager } from './rooms';

/** Constant-time comparison so a wrong guess can't be timed to learn the token. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A read-only operations page: room/game counts, nothing destructive. Gated by
 * a shared secret (ADMIN_TOKEN) rather than any session system, since the rest
 * of the app deliberately has no accounts. Fails closed if the token is unset.
 */
export function registerAdmin(app: FastifyInstance, rooms: RoomManager, bootTime: number): void {
  app.get('/admin', async (_req, reply) => {
    reply.type('text/html').send(ADMIN_HTML);
  });

  app.get('/admin/api/stats', async (req, reply) => {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      return reply
        .code(503)
        .send({ error: 'Admin dashboard disabled: set ADMIN_TOKEN to enable it' });
    }
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !tokensMatch(provided, expected)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return { ...rooms.stats(), bootTime, now: Date.now() };
  });
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>Tsipizard — Admin</title>
<style>
  :root {
    --ink-0: #0c0a16; --ink-1: #151228; --ink-2: #1f1a38;
    --gold: #d9ab5a; --gold-bright: #f0cf8a; --text: #efe8da; --text-dim: #a79f92;
    --good: #7fc98f; --bad: #e07a6f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--ink-0); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 24px 16px 60px;
  }
  h1 { font-size: 1.3rem; color: var(--gold-bright); margin: 0 0 4px; }
  .sub { color: var(--text-dim); margin: 0 0 28px; font-size: 0.85rem; }
  .wrap { max-width: 880px; margin: 0 auto; }
  .gate {
    max-width: 360px; margin: 15vh auto; display: flex; flex-direction: column; gap: 12px;
  }
  .gate input {
    background: var(--ink-1); border: 1px solid #ffffff2a; color: var(--text);
    border-radius: 8px; padding: 12px 14px; font-size: 1rem;
  }
  .gate button, .logout {
    background: var(--gold); color: #241a05; border: none; border-radius: 8px;
    padding: 11px; font-weight: 700; cursor: pointer; font-size: 0.95rem;
  }
  .logout { background: transparent; color: var(--text-dim); border: 1px solid #ffffff2a; }
  .error { color: var(--bad); font-size: 0.85rem; min-height: 1.2em; }
  .tiles {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px; margin-bottom: 28px;
  }
  .tile {
    background: var(--ink-1); border: 1px solid #ffffff14; border-radius: 12px; padding: 14px 16px;
  }
  .tile .n { font-size: 1.7rem; font-weight: 700; color: var(--gold-bright); }
  .tile .l { color: var(--text-dim); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ffffff10; }
  th { color: var(--gold); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .empty { color: var(--text-dim); font-style: italic; padding: 12px 0; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
  #app { display: none; }
</style>
</head>
<body>
  <div class="gate" id="gate">
    <h1>Tsipizard — Admin</h1>
    <p class="sub">Enter the admin token to continue.</p>
    <input type="password" id="tokenInput" placeholder="Admin token" autocomplete="off" />
    <button id="enterBtn">Enter</button>
    <p class="error" id="gateError"></p>
  </div>

  <div class="wrap" id="app">
    <div class="topbar">
      <div>
        <h1>Tsipizard — Admin</h1>
        <p class="sub" id="sub"></p>
      </div>
      <button class="logout" id="logoutBtn">Log out</button>
    </div>
    <div class="tiles" id="tiles"></div>
    <table>
      <thead>
        <tr><th>Code</th><th>Phase</th><th>Kind</th><th>Round</th><th>Players</th><th>Age</th></tr>
      </thead>
      <tbody id="roomRows"></tbody>
    </table>
  </div>

<script>
(function () {
  const KEY = 'tsipizard-admin-token';
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gateError');

  function phaseLabel(p) {
    return { choosingTrump: 'choosing trump', roundEnd: 'round end', gameOver: 'game over' }[p] || p;
  }
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  // Only poll while actually authenticated — otherwise a periodic tick after
  // a rejected token races the error message and silently blanks it out.
  let poll = null;
  function stopPolling() {
    if (poll) { clearInterval(poll); poll = null; }
  }
  function startPolling() {
    stopPolling();
    poll = setInterval(load, 5000);
  }

  async function load() {
    const token = localStorage.getItem(KEY);
    if (!token) { stopPolling(); showGate(''); return; }
    let res;
    try {
      res = await fetch('/admin/api/stats', { headers: { Authorization: 'Bearer ' + token } });
    } catch {
      stopPolling();
      showGate('Could not reach the server.');
      return;
    }
    if (res.status === 401) {
      stopPolling();
      localStorage.removeItem(KEY);
      showGate('That token was rejected.');
      return;
    }
    if (res.status === 503) {
      stopPolling();
      showGate('Admin dashboard is disabled — set ADMIN_TOKEN on the server.');
      return;
    }
    if (!res.ok) {
      stopPolling();
      showGate('Unexpected error (' + res.status + ').');
      return;
    }
    render(await res.json());
    startPolling();
  }

  function showGate(message) {
    gate.style.display = 'flex';
    app.style.display = 'none';
    gateError.textContent = message;
  }

  function render(s) {
    gate.style.display = 'none';
    app.style.display = 'block';
    document.getElementById('sub').textContent =
      'up ' + ago(s.bootTime) + ' · refreshed ' + new Date(s.now).toLocaleTimeString();

    const tiles = [
      ['Active rooms', s.activeRooms],
      ['Games in progress', s.activeGames],
      ['Lobbies waiting', s.lobbies],
      ['Awaiting restart', s.finishedGames],
      ['Connected players', s.connectedPlayers + ' / ' + s.totalPlayers],
      ['Games completed', s.completedGames],
    ];
    document.getElementById('tiles').innerHTML = tiles
      .map(([l, n]) => '<div class="tile"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>')
      .join('');

    const rows = document.getElementById('roomRows');
    if (s.rooms.length === 0) {
      rows.innerHTML = '<tr><td colspan="6" class="empty">No tables right now.</td></tr>';
    } else {
      rows.innerHTML = s.rooms
        .map(
          (r) =>
            '<tr><td>' + r.code + '</td><td>' + phaseLabel(r.phase) + '</td><td>' +
            (r.isPublic ? 'public' : 'private') + '</td><td>' +
            (r.round ? r.round + ' / ' + r.totalRounds : '—') + '</td><td>' +
            r.connectedCount + ' / ' + r.playerCount + '</td><td>' + ago(r.createdAt) + '</td></tr>',
        )
        .join('');
    }
  }

  document.getElementById('enterBtn').addEventListener('click', () => {
    const v = document.getElementById('tokenInput').value.trim();
    if (!v) return;
    localStorage.setItem(KEY, v);
    load();
  });
  document.getElementById('tokenInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('enterBtn').click();
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    stopPolling();
    localStorage.removeItem(KEY);
    showGate('');
  });

  load();
})();
</script>
</body>
</html>
`;
