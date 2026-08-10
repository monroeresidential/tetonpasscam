import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { setTestEmailFetcher } from '../../src/worker/notify';

interface CapturedEmail {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  json: { from: string; to: string; subject: string; text: string };
}

/** Stubs the Resend fetcher (see notify.ts's setTestEmailFetcher seam) and
 *  returns the array every call gets pushed into. Callers MUST clear the
 *  override afterward -- the top-level `afterEach` below does this
 *  automatically for every test in this file. */
function stubEmailFetcher(status = 200): CapturedEmail[] {
  const calls: CapturedEmail[] = [];
  setTestEmailFetcher(async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method,
      headers,
      json: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response('{}', { status });
  });
  return calls;
}

afterEach(() => {
  setTestEmailFetcher(undefined);
});

async function postAlert(bodyObj: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return api.request(
    '/alerts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(bodyObj),
    },
    env as any,
  );
}

async function getAlerts(): Promise<{ res: Response; body: any[] }> {
  const res = await api.request('/alerts', {}, env as any);
  const body = (await res.json()) as any[];
  return { res, body };
}

async function postCameraError(bodyObj: unknown): Promise<Response> {
  return api.request(
    '/camera-error',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    },
    env as any,
  );
}

async function alertRowByNote(note: string): Promise<any> {
  return env.DB.prepare('SELECT * FROM alerts WHERE note = ? ORDER BY id DESC LIMIT 1').bind(note).first();
}

async function countAlertsByDeviceHash(deviceHash: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT COUNT(*) n FROM alerts WHERE device_hash = ?')
    .bind(deviceHash)
    .first()) as { n: number };
  return row.n;
}

async function countAlertsByIpHash(ipHash: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT COUNT(*) n FROM alerts WHERE ip_hash = ?')
    .bind(ipHash)
    .first()) as { n: number };
  return row.n;
}

describe('POST /api/alerts', () => {
  it('valid POST ⇒ 201, hashed identifiers, correct expiry, one Resend call', async () => {
    const calls = stubEmailFetcher();
    const note = 'marker-valid-post';
    const before = Date.now();

    const res = await postAlert(
      { type: 'slick', note, direction: 'wb', deviceId: 'device-valid-post' },
      { 'CF-Connecting-IP': '203.0.113.1' },
    );
    expect(res.status).toBe(201);

    const row = await alertRowByNote(note);
    expect(row).toBeTruthy();
    expect(row.type).toBe('slick');
    expect(row.direction).toBe('wb');
    // Hashed, never the raw deviceId, and a proper SHA-256 hex digest.
    expect(row.device_hash).not.toBe('device-valid-post');
    expect(row.device_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.status).toBe('active');

    const createdMs = Date.parse(row.created_at);
    const expiresMs = Date.parse(row.expires_at);
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(expiresMs - createdMs).toBe(3 * 3_600_000); // slick ⇒ 3h

    expect(calls).toHaveLength(1);
    expect(calls[0].json.from).toBe('alerts@app.tetonpasscam.com');
    expect(calls[0].json.to).toBe(env.ADMIN_EMAIL);
    expect(calls[0].json.subject).toContain('slick');
    expect(calls[0].json.text).toContain(note);
    expect(calls[0].json.text).toContain('wb');
    expect(calls[0].headers.Authorization).toBe(`Bearer ${env.RESEND_KEY}`);
  });

  it('EXPIRY_HOURS per type: crash/stopped/slideoff/other 2h, slick/wildlife 3h, closure 1h', async () => {
    stubEmailFetcher();
    const cases: Array<{ type: string; hours: number }> = [
      { type: 'crash', hours: 2 },
      { type: 'stopped', hours: 2 },
      { type: 'slideoff', hours: 2 },
      { type: 'other', hours: 2 },
      { type: 'slick', hours: 3 },
      { type: 'wildlife', hours: 3 },
      { type: 'closure', hours: 1 },
    ];
    for (const { type, hours } of cases) {
      const note = `marker-expiry-${type}`;
      const res = await postAlert(
        { type, note, deviceId: `device-expiry-${type}` },
        { 'CF-Connecting-IP': `203.0.113.${type.length + 10}` },
      );
      expect(res.status).toBe(201);
      const row = await alertRowByNote(note);
      const createdMs = Date.parse(row.created_at);
      const expiresMs = Date.parse(row.expires_at);
      expect(expiresMs - createdMs).toBe(hours * 3_600_000);
    }
  });

  it('honeypot `website` filled ⇒ 201 fake success indistinguishable from a real acceptance, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const note = 'marker-honeypot';
    const res = await postAlert(
      { type: 'slick', note, direction: 'wb', deviceId: 'device-honeypot', website: 'http://spam.example.com' },
      { 'CF-Connecting-IP': '203.0.113.2' },
    );
    // Same status code and same PublicAlert shape a genuine 201 returns --
    // a bot probing the endpoint must not be able to tell the honeypot
    // field caused its submission to be discarded.
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).not.toHaveProperty('error');
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'direction', 'id', 'note', 'type'].sort());
    expect(typeof body.id).toBe('number');
    expect(body.type).toBe('slick');
    expect(body.note).toBe(note);
    expect(body.direction).toBe('wb');

    // ...but nothing was actually persisted or emailed.
    const row = await alertRowByNote(note);
    expect(row).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it('honeypot with an invalid `type` ⇒ still 201, fake body falls back to a valid type rather than leaking the raw value', async () => {
    const calls = stubEmailFetcher();
    const res = await postAlert(
      { type: 'not-a-real-type', deviceId: 'device-honeypot-bad-type', website: 'yes-a-bot' },
      { 'CF-Connecting-IP': '203.0.113.22' },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.type).toBe('other');
    expect(calls).toHaveLength(0);
  });

  it('unknown type ⇒ 400', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'not-a-real-type', deviceId: 'device-bad-type' },
      { 'CF-Connecting-IP': '203.0.113.3' },
    );
    expect(res.status).toBe(400);
  });

  it('note > 140 chars ⇒ 400', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', note: 'x'.repeat(141), deviceId: 'device-long-note' },
      { 'CF-Connecting-IP': '203.0.113.4' },
    );
    expect(res.status).toBe(400);
  });

  it('note exactly 140 chars ⇒ accepted', async () => {
    stubEmailFetcher();
    const note = 'y'.repeat(140);
    const res = await postAlert(
      { type: 'other', note, deviceId: 'device-140-note' },
      { 'CF-Connecting-IP': '203.0.113.5' },
    );
    expect(res.status).toBe(201);
  });

  it('invalid direction ⇒ 400', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', direction: 'north', deviceId: 'device-bad-direction' },
      { 'CF-Connecting-IP': '203.0.113.6' },
    );
    expect(res.status).toBe(400);
  });

  it('profane note ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', note: 'this road is shit today', deviceId: 'device-profane' },
      { 'CF-Connecting-IP': '203.0.113.7' },
    );
    expect(res.status).toBe(400);
    const row = await alertRowByNote('this road is shit today');
    expect(row).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it('profanity check is case-insensitive', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', note: 'SHIT show out here', deviceId: 'device-profane-caps' },
      { 'CF-Connecting-IP': '203.0.113.8' },
    );
    expect(res.status).toBe(400);
  });

  it('word-bounded profanity entries ("crap", "arse") do not false-positive on benign words containing them as a substring', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', note: 'sparse traffic on the scrap heap, coarse pavement too', deviceId: 'device-word-bound-ok' },
      { 'CF-Connecting-IP': '203.0.113.81' },
    );
    expect(res.status).toBe(201);
  });

  it('word-bounded profanity entries still block when they actually appear as a whole word', async () => {
    stubEmailFetcher();
    const crapRes = await postAlert(
      { type: 'other', note: 'this road is crap right now', deviceId: 'device-word-bound-crap' },
      { 'CF-Connecting-IP': '203.0.113.82' },
    );
    expect(crapRes.status).toBe(400);

    const arseRes = await postAlert(
      { type: 'other', note: 'what an arse move by that driver', deviceId: 'device-word-bound-arse' },
      { 'CF-Connecting-IP': '203.0.113.83' },
    );
    expect(arseRes.status).toBe(400);
  });

  it('missing deviceId ⇒ 400', async () => {
    stubEmailFetcher();
    const res = await postAlert({ type: 'other' }, { 'CF-Connecting-IP': '203.0.113.9' });
    expect(res.status).toBe(400);
  });

  it('3rd POST from the same device within 30 min ⇒ 429; only 2 rows persisted', async () => {
    stubEmailFetcher();
    const deviceId = 'device-rate-limit-test';
    const ip = '203.0.113.20';
    const first = await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });
    const second = await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });
    const third = await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);

    const firstBody = (await first.json()) as { id: number };
    const row = await env.DB.prepare('SELECT device_hash FROM alerts WHERE id = ?')
      .bind(firstBody.id)
      .first();
    expect(await countAlertsByDeviceHash((row as any).device_hash)).toBe(2);
  });

  it('rate-limited response body is exactly {error: "rate limited"} -- unchanged by the atomic-insert rewrite (LH T3 finding 5)', async () => {
    stubEmailFetcher();
    const deviceId = 'device-429-body-check';
    const ip = '203.0.113.92';
    await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });
    await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });
    const third = await postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip });
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: 'rate limited' });
  });

  it('5 simultaneous POSTs from the same device (Promise.all) ⇒ exactly 2 rows persisted, never more -- regression test for the check-then-insert race the atomic conditional insert closes (LH T3 finding 5)', async () => {
    stubEmailFetcher();
    const deviceId = 'device-burst-race-test';
    const ip = '203.0.113.93';

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postAlert({ type: 'other', deviceId }, { 'CF-Connecting-IP': ip })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);

    const successResponse = responses.find((r) => r.status === 201);
    const successBody = (await successResponse!.json()) as { id: number };
    const row = (await env.DB.prepare('SELECT device_hash FROM alerts WHERE id = ?')
      .bind(successBody.id)
      .first()) as any;
    expect(await countAlertsByDeviceHash(row.device_hash)).toBe(2);
  });

  it('deviceId of 129 chars ⇒ 400 (over the 128-char cap)', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', deviceId: 'd'.repeat(129) },
      { 'CF-Connecting-IP': '203.0.113.94' },
    );
    expect(res.status).toBe(400);
  });

  it('deviceId of exactly 128 chars ⇒ accepted', async () => {
    stubEmailFetcher();
    const res = await postAlert(
      { type: 'other', deviceId: 'd'.repeat(128) },
      { 'CF-Connecting-IP': '203.0.113.95' },
    );
    expect(res.status).toBe(201);
  });

  it('body over the 2KB cap ⇒ 413, no row, no email (LH T3 finding 7)', async () => {
    const calls = stubEmailFetcher();
    const oversizedNote = 'x'.repeat(3000);
    const res = await postAlert(
      { type: 'other', note: oversizedNote, deviceId: 'device-oversized-body' },
      { 'CF-Connecting-IP': '203.0.113.96' },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
    const row = await alertRowByNote(oversizedNote);
    expect(row).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it('6th POST from a different device but the same IP within 30 min ⇒ 429; only 5 rows persisted for that IP', async () => {
    stubEmailFetcher();
    const ip = '203.0.113.21';
    let lastDeviceHash = '';
    const responses: Response[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await postAlert({ type: 'other', deviceId: `device-ip-limit-${i}` }, { 'CF-Connecting-IP': ip });
      responses.push(res);
      if (res.status === 201) {
        const body = (await res.json()) as { id: number };
        const row = (await env.DB.prepare('SELECT ip_hash FROM alerts WHERE id = ?').bind(body.id).first()) as any;
        lastDeviceHash = row.ip_hash;
      }
    }
    expect(responses.slice(0, 5).map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(responses[5].status).toBe(429);
    expect(await countAlertsByIpHash(lastDeviceHash)).toBe(5);
  });

  it('banned device_hash ⇒ 403', async () => {
    stubEmailFetcher();
    const note = 'marker-ban-setup-device';
    const setupRes = await postAlert(
      { type: 'other', note, deviceId: 'device-to-be-banned' },
      { 'CF-Connecting-IP': '203.0.113.30' },
    );
    expect(setupRes.status).toBe(201);
    const row = await alertRowByNote(note);
    await env.DB.prepare(
      `INSERT INTO bans (device_hash, ip_hash, created_at) VALUES (?, NULL, ?)`,
    )
      .bind(row.device_hash, new Date().toISOString())
      .run();

    const res = await postAlert(
      { type: 'other', deviceId: 'device-to-be-banned' },
      { 'CF-Connecting-IP': '203.0.113.30' },
    );
    expect(res.status).toBe(403);
  });

  it('banned IP-only (device_hash null in bans row) ⇒ 403 for a different device sharing that IP', async () => {
    stubEmailFetcher();
    const note = 'marker-ban-setup-ip';
    const ip = '203.0.113.31';
    const setupRes = await postAlert({ type: 'other', note, deviceId: 'device-ip-ban-setup' }, { 'CF-Connecting-IP': ip });
    expect(setupRes.status).toBe(201);
    const row = await alertRowByNote(note);
    await env.DB.prepare(
      `INSERT INTO bans (device_hash, ip_hash, created_at) VALUES (NULL, ?, ?)`,
    )
      .bind(row.ip_hash, new Date().toISOString())
      .run();

    // A different deviceId, same banned IP.
    const res = await postAlert({ type: 'other', deviceId: 'device-not-otherwise-banned' }, { 'CF-Connecting-IP': ip });
    expect(res.status).toBe(403);
  });

  it('absent CF-Connecting-IP ⇒ still hashed as "unknown" and the request succeeds', async () => {
    stubEmailFetcher();
    const note = 'marker-no-ip-header';
    const res = await postAlert({ type: 'other', note, deviceId: 'device-no-ip-header' });
    expect(res.status).toBe(201);
    const row = await alertRowByNote(note);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('GET /api/alerts', () => {
  it('returns only active, unexpired alerts, newest first, with no hashes/status leaked', async () => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Active + unexpired -- should appear.
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
       VALUES (?, ?, 'crash', 'active and fresh', 'eb', 'devhash-active', 'iphash-active', 'active')`,
    )
      .bind(nowIso, new Date(now + 3_600_000).toISOString())
      .run();

    // Active but expired -- must be excluded.
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
       VALUES (?, ?, 'crash', 'active but expired', NULL, 'devhash-expired', 'iphash-expired', 'active')`,
    )
      .bind(new Date(now - 10 * 3_600_000).toISOString(), new Date(now - 8 * 3_600_000).toISOString())
      .run();

    // Removed, even though unexpired -- must be excluded.
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
       VALUES (?, ?, 'other', 'removed by admin', NULL, 'devhash-removed', 'iphash-removed', 'removed')`,
    )
      .bind(nowIso, new Date(now + 3_600_000).toISOString())
      .run();

    const { res, body } = await getAlerts();
    expect(res.status).toBe(200);

    const notes = body.map((a) => a.note);
    expect(notes).toContain('active and fresh');
    expect(notes).not.toContain('active but expired');
    expect(notes).not.toContain('removed by admin');

    const active = body.find((a) => a.note === 'active and fresh');
    expect(active).toMatchObject({ type: 'crash', direction: 'eb' });
    expect(Object.keys(active).sort()).toEqual(['createdAt', 'direction', 'id', 'note', 'type'].sort());
  });

  it('is newest-first', async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
       VALUES (?, ?, 'other', 'ordering-older', NULL, 'd1', 'i1', 'active')`,
    )
      .bind(new Date(now - 60_000).toISOString(), new Date(now + 3_600_000).toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, note, direction, device_hash, ip_hash, status)
       VALUES (?, ?, 'other', 'ordering-newer', NULL, 'd2', 'i2', 'active')`,
    )
      .bind(new Date(now).toISOString(), new Date(now + 3_600_000).toISOString())
      .run();

    const { body } = await getAlerts();
    const olderIdx = body.findIndex((a) => a.note === 'ordering-older');
    const newerIdx = body.findIndex((a) => a.note === 'ordering-newer');
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe('POST /api/camera-error', () => {
  it('first beacon for a camera today ⇒ sends one email; a second the same day sends none', async () => {
    const calls = stubEmailFetcher();
    const camera = 'valley'; // canonical allowlisted id

    const first = await postCameraError({ camera });
    expect(first.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].json.subject).toContain(camera);

    const second = await postCameraError({ camera });
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(1); // unchanged -- throttled
  });

  it('a beacon for a NEW day (prior day already recorded) ⇒ sends an email again', async () => {
    const calls = stubEmailFetcher();
    const camera = 'east'; // canonical allowlisted id
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    const yesterdayDay = yesterday.toISOString().slice(0, 10);

    // Simulate "yesterday's" beacon already having been recorded, without
    // needing a date-pinnable clock seam on the handler itself.
    await env.DB.prepare(`INSERT INTO camera_errors (camera, day, created_at) VALUES (?, ?, ?)`)
      .bind(camera, yesterdayDay, yesterday.toISOString())
      .run();

    const res = await postCameraError({ camera });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('missing camera ⇒ 400, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postCameraError({});
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('unknown/unlisted camera id ⇒ 400, no row, no email (caps the flood surface to the allowlist)', async () => {
    const calls = stubEmailFetcher();
    const res = await postCameraError({ camera: 'some-arbitrary-string-an-attacker-picked' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
    const row = await env.DB.prepare('SELECT 1 FROM camera_errors WHERE camera = ?')
      .bind('some-arbitrary-string-an-attacker-picked')
      .first();
    expect(row).toBeFalsy();
  });

  it('each of the three canonical camera ids (valley, east, west) is accepted', async () => {
    stubEmailFetcher();
    for (const camera of ['valley', 'east', 'west']) {
      const res = await postCameraError({ camera });
      expect(res.status).toBe(200);
    }
  });

  it('body over the 1KB cap ⇒ 413, no email (LH T3 finding 7)', async () => {
    // No "no row" assertion here -- earlier tests in this shared-D1-per-file
    // suite already recorded a `valley` row for today (camera_errors is
    // UNIQUE(camera, day)), so presence/absence of a `valley` row isn't a
    // meaningful signal for THIS request. The email check is: the size cap
    // must reject the request before it ever reaches postCameraError, so no
    // NEW email fires for it.
    const calls = stubEmailFetcher();
    const res = await postCameraError({ camera: 'valley', junk: 'x'.repeat(2000) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
    expect(calls).toHaveLength(0);
  });
});
