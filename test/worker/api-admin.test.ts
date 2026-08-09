import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { setTestEmailFetcher } from '../../src/worker/notify';

afterEach(() => {
  setTestEmailFetcher(undefined);
});

async function adminRequest(
  path: string,
  init: RequestInit = {},
  token: string | null | undefined = env.ADMIN_TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) };
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  return api.request(`/admin${path}`, { ...init, headers }, env as any);
}

async function insertAlert(overrides: {
  note: string;
  status: 'active' | 'expired' | 'removed';
  createdAt?: string;
  deviceHash?: string;
  ipHash?: string | null;
}): Promise<number> {
  const now = Date.now();
  const createdAt = overrides.createdAt ?? new Date(now).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
     VALUES (?, ?, 'other', ?, NULL, ?, ?, ?)`,
  )
    .bind(
      createdAt,
      new Date(now + 3_600_000).toISOString(),
      overrides.note,
      overrides.deviceHash ?? `devhash-${overrides.note}`,
      overrides.ipHash ?? `iphash-${overrides.note}`,
      overrides.status,
    )
    .run();
  const row = (await env.DB.prepare('SELECT id FROM alerts WHERE note = ? ORDER BY id DESC LIMIT 1')
    .bind(overrides.note)
    .first()) as { id: number };
  return row.id;
}

describe('admin auth', () => {
  const routes: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/alerts' },
    { method: 'DELETE', path: '/alerts/1' },
    { method: 'POST', path: '/bans' },
    { method: 'GET', path: '/feedback' },
    { method: 'GET', path: '/not-a-real-subpath' },
  ];

  for (const { method, path } of routes) {
    it(`${method} ${path} with no token ⇒ 401`, async () => {
      const res = await adminRequest(path, { method }, null);
      expect(res.status).toBe(401);
    });

    it(`${method} ${path} with wrong token ⇒ 401`, async () => {
      const res = await adminRequest(path, { method }, 'totally-wrong-token');
      expect(res.status).toBe(401);
    });
  }

  it('401 body is generic (no leakage of expected token or details)', async () => {
    const res = await adminRequest('/alerts', { method: 'GET' }, 'wrong');
    const body = (await res.json()) as any;
    expect(JSON.stringify(body)).not.toContain(env.ADMIN_TOKEN);
    expect(res.status).toBe(401);
  });

  it('correct token ⇒ not 401', async () => {
    const res = await adminRequest('/alerts', { method: 'GET' });
    expect(res.status).not.toBe(401);
  });
});

describe('GET /api/admin/alerts', () => {
  it('returns alerts of every status, newest first, including device_hash/ip_hash', async () => {
    await insertAlert({ note: 'admin-active', status: 'active', createdAt: new Date(Date.now() - 3000).toISOString() });
    await insertAlert({ note: 'admin-expired', status: 'expired', createdAt: new Date(Date.now() - 2000).toISOString() });
    await insertAlert({ note: 'admin-removed', status: 'removed', createdAt: new Date(Date.now() - 1000).toISOString() });

    const res = await adminRequest('/alerts', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    const notes = body.map((a) => a.note);
    expect(notes).toContain('admin-active');
    expect(notes).toContain('admin-expired');
    expect(notes).toContain('admin-removed');

    const active = body.find((a) => a.note === 'admin-active');
    expect(active).toHaveProperty('deviceHash');
    expect(active).toHaveProperty('ipHash');
    expect(active.status).toBe('active');
    const removed = body.find((a) => a.note === 'admin-removed');
    expect(removed.status).toBe('removed');

    // newest-first
    const activeIdx = notes.indexOf('admin-active');
    const expiredIdx = notes.indexOf('admin-expired');
    const removedIdx = notes.indexOf('admin-removed');
    expect(removedIdx).toBeLessThan(expiredIdx);
    expect(expiredIdx).toBeLessThan(activeIdx);
  });
});

describe('DELETE /api/admin/alerts/:id', () => {
  it('flips status to removed, keeps the row', async () => {
    const id = await insertAlert({ note: 'admin-delete-me', status: 'active' });
    const res = await adminRequest(`/alerts/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const row = (await env.DB.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first()) as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe('removed');
  });

  it('unknown id ⇒ 404', async () => {
    const res = await adminRequest('/alerts/999999999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/bans', () => {
  it('neither deviceHash nor ipHash ⇒ 400', async () => {
    const res = await adminRequest('/bans', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('deviceHash only ⇒ 201 with the row', async () => {
    const res = await adminRequest('/bans', {
      method: 'POST',
      body: JSON.stringify({ deviceHash: 'some-device-hash' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.deviceHash).toBe('some-device-hash');
    expect(body.ipHash).toBeNull();
  });

  it('ipHash only ⇒ 201 with the row', async () => {
    const res = await adminRequest('/bans', {
      method: 'POST',
      body: JSON.stringify({ ipHash: 'some-ip-hash' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.ipHash).toBe('some-ip-hash');
    expect(body.deviceHash).toBeNull();
  });

  it('banning a device hash blocks further POST /api/alerts from that device (Task 10 integration)', async () => {
    stubEmailFetcher();
    const deviceId = 'device-admin-ban-target';
    const setupRes = await api.request(
      '/alerts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', deviceId }),
      },
      env as any,
    );
    expect(setupRes.status).toBe(201);
    const row = (await env.DB.prepare('SELECT device_hash FROM alerts WHERE device_hash IS NOT NULL ORDER BY id DESC LIMIT 1').first()) as any;

    const banRes = await adminRequest('/bans', {
      method: 'POST',
      body: JSON.stringify({ deviceHash: row.device_hash }),
    });
    expect(banRes.status).toBe(201);

    const blockedRes = await api.request(
      '/alerts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'other', deviceId }),
      },
      env as any,
    );
    expect(blockedRes.status).toBe(403);
  });

  it('banning an ip hash blocks further POST /api/alerts from that ip (Task 10 integration)', async () => {
    stubEmailFetcher();
    const ip = '198.51.100.77';
    const note = 'marker-admin-ip-ban-setup';
    const setupRes = await api.request(
      '/alerts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ type: 'other', note, deviceId: 'device-admin-ip-ban-setup' }),
      },
      env as any,
    );
    expect(setupRes.status).toBe(201);
    const row = (await env.DB.prepare('SELECT ip_hash FROM alerts WHERE note = ? ORDER BY id DESC LIMIT 1')
      .bind(note)
      .first()) as any;

    const banRes = await adminRequest('/bans', {
      method: 'POST',
      body: JSON.stringify({ ipHash: row.ip_hash }),
    });
    expect(banRes.status).toBe(201);

    const blockedRes = await api.request(
      '/alerts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ type: 'other', deviceId: 'device-admin-ip-ban-different-device' }),
      },
      env as any,
    );
    expect(blockedRes.status).toBe(403);
  });
});

describe('GET /api/admin/feedback', () => {
  it('lists feedback newest-first', async () => {
    await env.DB.prepare(`INSERT INTO feedback (created_at, body, email) VALUES (?, ?, NULL)`)
      .bind(new Date(Date.now() - 2000).toISOString(), 'admin-feedback-older')
      .run();
    await env.DB.prepare(`INSERT INTO feedback (created_at, body, email) VALUES (?, ?, NULL)`)
      .bind(new Date(Date.now() - 1000).toISOString(), 'admin-feedback-newer')
      .run();

    const res = await adminRequest('/feedback', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    const olderIdx = body.findIndex((f) => f.body === 'admin-feedback-older');
    const newerIdx = body.findIndex((f) => f.body === 'admin-feedback-newer');
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

function stubEmailFetcher(status = 200) {
  setTestEmailFetcher(async () => new Response('{}', { status }));
}
