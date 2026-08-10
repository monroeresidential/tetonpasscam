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

async function get(pathAndQuery: string): Promise<Response> {
  const request = new Request(`https://tetonpasscam.com${pathAndQuery}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function insertSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
}): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, NULL, '[]', '[]', ?, 'primary')
     RETURNING id`,
  )
    .bind(overrides.capturedAt, overrides.status, overrides.capturedAt)
    .first<{ id: number }>();
  return result!.id;
}

/** Reads a PNG's IHDR width/height (big-endian uint32 at byte offsets
 *  16-19/20-23, right after the 8-byte signature + 4-byte length + 4-byte
 *  "IHDR" type of the first chunk, which is always IHDR per the PNG spec). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('GET /og/{id}-{dir}.png', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('renders a real 1200x630 PNG with the correct magic bytes and immutable cache headers', async () => {
    const capturedAt = new Date('2026-08-10T18:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/og/${id}-eb.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
  }, 20000);

  it('404s for a non-numeric id', async () => {
    const res = await get('/og/not-a-number-eb.png');
    expect(res.status).toBe(404);
  });

  it('404s for an invalid direction', async () => {
    const capturedAt = new Date('2026-08-10T18:05:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });
    const res = await get(`/og/${id}-nb.png`);
    expect(res.status).toBe(404);
  });

  it('404s for an id with no matching snapshot', async () => {
    const res = await get('/og/999999999-eb.png');
    expect(res.status).toBe(404);
  });

  it('caches a successful render: a second request reflects the FIRST render even after the row changes', async () => {
    const capturedAt = new Date('2026-08-10T18:10:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const first = await get(`/og/${id}-eb.png`);
    expect(first.status).toBe(200);
    const firstBytes = new Uint8Array(await first.arrayBuffer());

    await env.DB.prepare(`UPDATE status_snapshots SET status = 'closed' WHERE id = ?`).bind(id).run();

    const second = await get(`/og/${id}-eb.png`);
    expect(second.status).toBe(200);
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    expect(secondBytes).toEqual(firstBytes);
  }, 20000);
});

describe('GET /s/{id}', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('rewrites og:image/twitter:image/og:url/og:title, leaves canonical untouched', async () => {
    const capturedAt = new Date('2026-08-10T19:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();

    expect(html).toContain(`https://tetonpasscam.com/og/${id}-eb.png`);
    expect(html).toContain(`https://tetonpasscam.com/s/${id}`);
    expect(html).toContain('Teton Pass is OPEN — live conditions');
    expect(html).toContain('<link rel="canonical" href="https://tetonpasscam.com/" />');
  });

  it('?dir=wb builds the wb-direction /og URL and preserves the query on og:url', async () => {
    const capturedAt = new Date('2026-08-10T19:05:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${id}?dir=wb`);
    const html = await res.text();
    expect(html).toContain(`https://tetonpasscam.com/og/${id}-wb.png`);
    expect(html).toContain(`https://tetonpasscam.com/s/${id}?dir=wb`);
  });

  it('CLOSED snapshot ⇒ og:title says CLOSED', async () => {
    const capturedAt = new Date('2026-08-10T19:10:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'closed' });

    const res = await get(`/s/${id}`);
    const html = await res.text();
    expect(html).toContain('Teton Pass is CLOSED — live conditions');
  });

  it('redirects to / for a non-numeric id', async () => {
    const res = await get('/s/not-a-number');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/');
  });

  it('redirects to / for an id with no matching snapshot', async () => {
    const res = await get('/s/999999999');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/');
  });

  it('sets the homepage-style short-cache headers, strips ETag/Last-Modified', async () => {
    const capturedAt = new Date('2026-08-10T19:15:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const res = await get(`/s/${id}`);
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, max-age=0, must-revalidate');
    expect(res.headers.get('ETag')).toBeNull();
    expect(res.headers.get('Last-Modified')).toBeNull();
  });
});
