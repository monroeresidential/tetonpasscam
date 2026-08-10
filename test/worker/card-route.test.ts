// HTTP-level tests for the /og and /s routes (src/worker/card/route.ts),
// exercised through the real top-level `worker.fetch` (same technique as
// test/worker/index.test.ts/seo-inject.test.ts) so caches.default/ASSETS
// are exercised the same way production traffic would hit them. Only ONE
// test here (the "renders a real PNG" case) goes through the actual
// satori/resvg WASM rasterization -- everything else (404s, redirects, the
// /s meta-tag rewrite, cache headers) is covered at the HTML-string/data
// layer in card-render.test.ts/card-data.test.ts and doesn't need it.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import worker from '../../src/worker/index';
import { formatShareCode } from '../../src/worker/share-code';

async function get(pathAndQuery: string): Promise<Response> {
  const request = new Request(`https://tetonpasscam.com${pathAndQuery}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Inserts a status_snapshots row and returns its share code (the
 *  America/Denver `YYYYMMDD-HHmm` rendering of `capturedAt`) alongside its
 *  raw id, since a couple of tests below still need the id to mutate the row
 *  directly (the cache-immutability test). */
async function insertSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
}): Promise<{ id: number; code: string }> {
  const result = await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, NULL, '[]', '[]', ?, 'primary')
     RETURNING id`,
  )
    .bind(overrides.capturedAt, overrides.status, overrides.capturedAt)
    .first<{ id: number }>();
  return { id: result!.id, code: formatShareCode(overrides.capturedAt) };
}

/** Reads a PNG's IHDR width/height (big-endian uint32 at byte offsets
 *  16-19/20-23, right after the 8-byte signature + 4-byte length + 4-byte
 *  "IHDR" type of the first chunk, which is always IHDR per the PNG spec). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('GET /og/{code}-{dir}.png', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('renders a real 1200x630 PNG with the correct magic bytes and immutable cache headers', async () => {
    const capturedAt = new Date('2026-08-10T18:00:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/og/${code}-eb.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
  }, 20000);

  it('404s for a malformed code (old-style numeric id)', async () => {
    const res = await get('/og/53-eb.png');
    expect(res.status).toBe(404);
  });

  it('404s for an injection-y path segment (rejected by the route regex before any DB lookup)', async () => {
    const res = await get(`/og/${encodeURIComponent("' OR 1=1--")}-eb.png`);
    expect(res.status).toBe(404);
  });

  it('404s for an invalid direction', async () => {
    const capturedAt = new Date('2026-08-10T18:05:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });
    const res = await get(`/og/${code}-nb.png`);
    expect(res.status).toBe(404);
  });

  it('404s for a well-formed code with no matching snapshot', async () => {
    const res = await get('/og/20990101-0000-eb.png');
    expect(res.status).toBe(404);
  });

  it('caches a successful render: a second request reflects the FIRST render even after the row changes', async () => {
    const capturedAt = new Date('2026-08-10T18:10:00.000Z').toISOString();
    const { id, code } = await insertSnapshot({ capturedAt, status: 'open' });

    const first = await get(`/og/${code}-eb.png`);
    expect(first.status).toBe(200);
    const firstBytes = new Uint8Array(await first.arrayBuffer());

    await env.DB.prepare(`UPDATE status_snapshots SET status = 'closed' WHERE id = ?`).bind(id).run();

    const second = await get(`/og/${code}-eb.png`);
    expect(second.status).toBe(200);
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    expect(secondBytes).toEqual(firstBytes);
  }, 20000);

  it('resolves a snapshot captured just after the spring-forward DST jump via the window scan', async () => {
    // 2026-03-08 02:00 America/Denver -> 03:00 (spring forward): a snapshot
    // captured at 2026-03-08T09:15:00Z reads as 03:15 MDT (GMT-6), but the
    // constant-offset window guess (from that day's midnight, still
    // MST/GMT-7 at 00:00) lands on 10:15 UTC, an hour off -- only the
    // bounded window scan (data.ts's resolveShareCode) finds this row.
    const capturedAt = new Date('2026-03-08T09:15:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });
    expect(code).toBe('20260308-0315');

    const res = await get(`/og/${code}-eb.png`);
    expect(res.status).toBe(200);
  }, 20000);
});

describe('GET /s/{code}', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('rewrites og:image/twitter:image/og:url/og:title, leaves canonical untouched', async () => {
    const capturedAt = new Date('2026-08-10T19:00:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();

    expect(html).toContain(`https://tetonpasscam.com/og/${code}-eb.png`);
    expect(html).toContain(`https://tetonpasscam.com/s/${code}`);
    expect(html).toContain('Teton Pass is OPEN — live conditions');
    expect(html).toContain('<link rel="canonical" href="https://tetonpasscam.com/" />');
  });

  it('?dir=wb builds the wb-direction /og URL and preserves the query on og:url', async () => {
    const capturedAt = new Date('2026-08-10T19:05:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${code}?dir=wb`);
    const html = await res.text();
    expect(html).toContain(`https://tetonpasscam.com/og/${code}-wb.png`);
    expect(html).toContain(`https://tetonpasscam.com/s/${code}?dir=wb`);
  });

  it('CLOSED snapshot ⇒ og:title says CLOSED', async () => {
    const capturedAt = new Date('2026-08-10T19:10:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'closed' });

    const res = await get(`/s/${code}`);
    const html = await res.text();
    expect(html).toContain('Teton Pass is CLOSED — live conditions');
  });

  it('redirects to / for a malformed code (old-style numeric id)', async () => {
    const res = await get('/s/53');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/');
  });

  it('redirects to / for an injection-y path segment', async () => {
    const res = await get(`/s/${encodeURIComponent("'; DROP TABLE status_snapshots;--")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/');
  });

  it('redirects to / for a well-formed code with no matching snapshot', async () => {
    const res = await get('/s/20990101-0000');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/');
  });

  it('resolves a snapshot captured just after the spring-forward DST jump via the window scan', async () => {
    const capturedAt = new Date('2026-03-08T09:20:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });
    expect(code).toBe('20260308-0320');

    const res = await get(`/s/${code}`);
    expect(res.status).toBe(200);
  });

  it('fall-back night: a code shared by two real snapshots an hour apart resolves to the NEWER one', async () => {
    // 2026-11-01 02:00 America/Denver falls back to 01:00 -- 01:45 MDT
    // (2026-11-01T07:45:00Z) and 01:45 MST (2026-11-01T08:45:00Z, an hour
    // later) both format to the same code. The og:title reflecting the
    // NEWER (closed) snapshot's status, not the older (open) one's, proves
    // resolveShareCode's newest-wins fix end-to-end, not just at the id
    // level (see card-data.test.ts's more direct regression test).
    const olderCapturedAt = new Date('2026-11-01T07:45:00.000Z').toISOString();
    const newerCapturedAt = new Date('2026-11-01T08:45:00.000Z').toISOString();
    const older = await insertSnapshot({ capturedAt: olderCapturedAt, status: 'open' });
    const newer = await insertSnapshot({ capturedAt: newerCapturedAt, status: 'closed' });
    expect(newer.code).toBe(older.code);

    const res = await get(`/s/${newer.code}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Teton Pass is CLOSED — live conditions');
  });

  it('sets the homepage-style short-cache headers, strips ETag/Last-Modified', async () => {
    const capturedAt = new Date('2026-08-10T19:15:00.000Z').toISOString();
    const { code } = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${code}`);
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, max-age=0, must-revalidate');
    expect(res.headers.get('ETag')).toBeNull();
    expect(res.headers.get('Last-Modified')).toBeNull();
  });
});
