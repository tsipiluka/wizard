import { afterEach, describe, expect, test } from 'vitest';
import { buildServer, type BuiltServer } from '../src/app';

describe('admin dashboard', () => {
  let built: BuiltServer | undefined;
  const originalToken = process.env.ADMIN_TOKEN;

  afterEach(async () => {
    await built?.app.close();
    built = undefined;
    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });

  test('the stats API is disabled (503) when ADMIN_TOKEN is not configured', async () => {
    delete process.env.ADMIN_TOKEN;
    built = await buildServer();
    const res = await built.app.inject({ method: 'GET', url: '/admin/api/stats' });
    expect(res.statusCode).toBe(503);
  });

  test('the stats API rejects missing or wrong bearer tokens', async () => {
    process.env.ADMIN_TOKEN = 'super-secret-token';
    built = await buildServer();

    const noAuth = await built.app.inject({ method: 'GET', url: '/admin/api/stats' });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await built.app.inject({
      method: 'GET',
      url: '/admin/api/stats',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(wrong.statusCode).toBe(401);

    // a token that merely starts with the right value must not pass a naive comparison
    const prefix = await built.app.inject({
      method: 'GET',
      url: '/admin/api/stats',
      headers: { authorization: 'Bearer super-secret-token-extra' },
    });
    expect(prefix.statusCode).toBe(401);
  });

  test('the stats API accepts the correct bearer token and reflects real room state', async () => {
    process.env.ADMIN_TOKEN = 'super-secret-token';
    built = await buildServer();
    built.rooms.create('Ana');

    const res = await built.app.inject({
      method: 'GET',
      url: '/admin/api/stats',
      headers: { authorization: 'Bearer super-secret-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ activeRooms: 1, lobbies: 1, completedGames: 0 });
  });

  test('the admin page renders without auth (so the token prompt can load) but leaks no secret', async () => {
    process.env.ADMIN_TOKEN = 'super-secret-token';
    built = await buildServer();
    const res = await built.app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).not.toContain('super-secret-token');
  });
});
