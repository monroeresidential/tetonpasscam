// HTTP-level tests for GET /embed/{badge,card,strip} (src/worker/embed.ts),
// exercised through the real top-level `worker.fetch` (same technique as
// card-route.test.ts) so caches.default is exercised the same way
// production traffic would hit it.
//
// Cache-key isolation: `caches.default` persists across tests within this
// file (fresh only per FILE -- see seo-inject.test.ts's own comment on the
// same thing), so each test uses a distinct query string on `/embed/{variant}`
// to get its own cache entry; EMBED_PATH_RE in embed.ts matches on pathname
// only, so the query string never affects which variant/branch renders.
//
// The one "bare /embed passes through" case is tested at the unit level
// instead (calling handleEmbedRequest directly) -- going through the full
// worker would fall all the way to env.ASSETS.fetch, which depends on
// `dist/embed.html` existing from a prior `vite build`, a dependency this
// suite shouldn't need.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import { handleEmbedRequest } from '../../src/worker/embed';
import worker from '../../src/worker/index';

const MIN_MS = 60_000;
let cacheBust = 0;

async function get(pathAndQuery: string): Promise<Response> {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const request = new Request(`https://tetonpasscam.com${pathAndQuery}${sep}cb=${cacheBust++}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function insertSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, NULL, '[]', '[]', ?, 'primary')`,
  )
    .bind(overrides.capturedAt, overrides.status, overrides.capturedAt)
    .run();
}

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

// `getStatus` picks each route's LATEST row by MAX(captured_at), and
// travel_times accumulates across every test in this file (fresh only per
// FILE, same as D1 generally -- see apply-migrations.ts's comment) -- so
// without this, a later test inserting a deliberately-old (stale) row for a
// route that an earlier test already gave a fresher timestamp would never
// actually become "latest". Clearing the route's history first makes each
// call the sole, and therefore always-latest, row for that route,
// independent of what ran before it or in what order.
async function insertTravelTime(slug: string, capturedAt: string, durationSec: number): Promise<void> {
  const id = await routeId(slug);
  await env.DB.prepare(`DELETE FROM travel_times WHERE route_id = ?`).bind(id).run();
  await env.DB.prepare(
    `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`,
  )
    .bind(id, capturedAt, durationSec)
    .run();
}

describe('GET /embed/{badge,card,strip}', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it.each(['badge', 'card', 'strip'] as const)(
    '%s: fresh open snapshot -> 200 text/html, OPEN, correct utm_campaign, 5-min cache, no X-Frame-Options',
    async (variant) => {
      const now = new Date().toISOString();
      await insertSnapshot({ capturedAt: now, status: 'open' });
      await insertTravelTime('victor-jackson-eb', now, 38 * 60);
      await insertTravelTime('driggs-jackson-eb', now, 46 * 60);

      const res = await get(`/embed/${variant}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
      expect(res.headers.get('X-Frame-Options')).toBeNull();

      const html = await res.text();
      expect(html).toContain('OPEN');
      expect(html).toContain(
        `https://tetonpasscam.com/?utm_source=embed&amp;utm_medium=widget&amp;utm_campaign=${variant}`,
      );
    },
  );

  it.each(['badge', 'card', 'strip'] as const)(
    '%s: closed snapshot -> CLOSED + "do not attempt" (case-insensitive), never an invented reopening time',
    async (variant) => {
      const now = new Date().toISOString();
      await insertSnapshot({ capturedAt: now, status: 'closed' });

      const res = await get(`/embed/${variant}`);
      const html = await res.text();
      expect(html).toContain('CLOSED');
      expect(html.toLowerCase()).toContain('do not attempt');
      expect(html).not.toMatch(/reopen/i);
    },
  );

  it('card: closed snapshot renders no drive-time "min" values in the card middle', async () => {
    const now = new Date().toISOString();
    await insertSnapshot({ capturedAt: now, status: 'closed' });

    const res = await get('/embed/card');
    const html = await res.text();
    const bodyMatch = html.match(/<div class="card-body">([\s\S]*?)<\/div>\s*<div class="card-footer">/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\d+\s*min\b/);
  });

  it.each(['badge', 'card', 'strip'] as const)(
    '%s: no snapshot at all (unknown) -> UNKNOWN, never renders "is OPEN"',
    async (variant) => {
      // Fresh D1 per FILE, and this describe block runs after other tests in
      // this file have already inserted rows -- delete them rather than
      // relying on file-load ordering (unlike api-status.test.ts's one
      // guaranteed-empty-table test, this suite doesn't need a truly virgin
      // table, just "no snapshot", which deleting achieves just as validly).
      await env.DB.prepare('DELETE FROM status_snapshots').run();

      const res = await get(`/embed/${variant}`);
      const html = await res.text();
      expect(html).toContain('UNKNOWN');
      expect(html).not.toContain('is OPEN');
    },
  );

  it('/embed/bogus -> 404', async () => {
    const res = await get('/embed/bogus');
    expect(res.status).toBe(404);
  });

  it('bare /embed is NOT handled by the widget handler (returns null, falls through to ASSETS)', async () => {
    const request = new Request('https://tetonpasscam.com/embed');
    const result = await handleEmbedRequest(request, env as any);
    expect(result).toBeNull();
  });

  it('a non-GET request to /embed/badge is NOT handled by the widget handler', async () => {
    const request = new Request('https://tetonpasscam.com/embed/badge', { method: 'POST' });
    const result = await handleEmbedRequest(request, env as any);
    expect(result).toBeNull();
  });

  it.each(['badge', 'strip'] as const)(
    '%s: a stale travel-time row suffixes the times line with "as of"',
    async (variant) => {
      const now = Date.now();
      await insertSnapshot({ capturedAt: new Date(now).toISOString(), status: 'open' });
      const staleAt = new Date(now - 45 * MIN_MS).toISOString(); // between the 30min freshness window and 12h max-age cap
      await insertTravelTime('victor-jackson-eb', staleAt, 40 * 60);
      await insertTravelTime('driggs-jackson-eb', new Date(now).toISOString(), 46 * 60);

      const res = await get(`/embed/${variant}`);
      const html = await res.text();
      expect(html).toContain('as of');
    },
  );

  it('card: restricted status still shows drive times when present', async () => {
    const now = new Date().toISOString();
    await insertSnapshot({ capturedAt: now, status: 'restricted' });
    await insertTravelTime('victor-jackson-eb', now, 50 * 60);
    await insertTravelTime('driggs-jackson-eb', now, 58 * 60);

    const res = await get('/embed/card');
    const html = await res.text();
    expect(html).toContain('RESTRICTED');
    expect(html).toContain('50 min');
    expect(html).toContain('58 min');
  });
});
