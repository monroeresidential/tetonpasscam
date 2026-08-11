// HTTP-level tests for GET /embed/{badge,card,strip} (src/worker/embed.ts),
// exercised through the real top-level `worker.fetch` (same technique as
// card-route.test.ts) so caches.default is exercised the same way
// production traffic would hit it.
//
// Cache-key isolation: embed.ts now canonicalizes the cache key to
// `/embed/{variant}?dir={eb|wb}` (dropping every other query param, on
// purpose -- see embed.ts's own comment on why), so the OLD trick this file
// used (a unique `?cb=` cache-buster per request) no longer gives each test
// its own entry: everything collapses onto just two keys per variant.
// `get()` below instead explicitly deletes both of a variant's canonical
// entries before firing the request, so each call starts from a guaranteed
// cache miss regardless of what earlier tests in this file (`caches.default`
// persists per FILE, same as seo-inject.test.ts's own note on that) left
// behind. The one test that deliberately wants a cache HIT to survive across
// two calls (cache canonicalization, below) bypasses `get()` for that
// reason.
//
// The one "bare /embed passes through" case is tested at the unit level
// instead (calling handleEmbedRequest directly) -- going through the full
// worker would fall all the way to env.ASSETS.fetch, which depends on
// `dist/embed.html` existing from a prior `vite build`, a dependency this
// suite shouldn't need.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { setTestNowMs } from '../../src/worker/api/status';
import { seedRoutes } from '../../src/worker/db/seed-routes';
import { handleEmbedRequest } from '../../src/worker/embed';
import worker from '../../src/worker/index';

const MIN_MS = 60_000;

// Same DOM-vs-Workers-types cast embed.ts's own `cacheApi()` needs.
function cacheApi(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

async function purgeEmbedCache(variant: string): Promise<void> {
  const cache = cacheApi();
  await cache.delete(new Request(`https://tetonpasscam.com/embed/${variant}?dir=eb`));
  await cache.delete(new Request(`https://tetonpasscam.com/embed/${variant}?dir=wb`));
}

async function get(pathAndQuery: string): Promise<Response> {
  const variantMatch = pathAndQuery.match(/^\/embed\/(badge|card|strip)\b/);
  if (variantMatch) await purgeEmbedCache(variantMatch[1]);

  const request = new Request(`https://tetonpasscam.com${pathAndQuery}`);
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

  describe('?dir=', () => {
    it.each(['badge', 'card', 'strip'] as const)(
      '%s: ?dir=wb -> Jackson->Victor/Driggs labels, wb durations, utm_content=wb',
      async (variant) => {
        const now = new Date().toISOString();
        await insertSnapshot({ capturedAt: now, status: 'open' });
        // Distinct from the eb durations used elsewhere in this file, so a
        // row that accidentally rendered the eb slug's time would show a
        // different (wrong) number here.
        await insertTravelTime('victor-jackson-wb', now, 33 * 60);
        await insertTravelTime('driggs-jackson-wb', now, 41 * 60);

        const res = await get(`/embed/${variant}?dir=wb`);
        const html = await res.text();
        expect(html).toContain('33 min');
        expect(html).toContain('41 min');
        expect(html).not.toMatch(/Victor → Jackson|Victor→JAC/);
        expect(html).toMatch(/Jackson → Victor|JAC→Victor/);
        expect(html).toMatch(/Jackson → Driggs|JAC→Driggs/);
        expect(html).toContain(`utm_content=wb`);
      },
    );

    it.each(['badge', 'card', 'strip'] as const)(
      '%s: ?dir=bogus and no dir param both render identical eb output',
      async (variant) => {
        const now = new Date().toISOString();
        await insertSnapshot({ capturedAt: now, status: 'open' });
        await insertTravelTime('victor-jackson-eb', now, 38 * 60);
        await insertTravelTime('driggs-jackson-eb', now, 46 * 60);

        const bare = await get(`/embed/${variant}`);
        const bareHtml = await bare.text();
        const bogus = await get(`/embed/${variant}?dir=bogus`);
        const bogusHtml = await bogus.text();

        expect(bogusHtml).toBe(bareHtml);
        expect(bareHtml).toContain('utm_content=eb');
      },
    );

    it.each(['badge', 'card', 'strip'] as const)(
      '%s: ?dir=auto resolves eb before noon and wb from noon on, America/Denver',
      async (variant) => {
        // Fixed captured-at, ~1h before either pinned "now" below (not real
        // Date.now()) -- this test pins the clock used to RESOLVE direction,
        // but getStatus's own freshness/dead-poller checks (DEAD_HOURS,
        // TRAVEL_TIME_MAX_AGE_HOURS) run against that SAME pinned clock, so
        // data captured at the real wall-clock time could land arbitrarily
        // far from it and get excluded as stale/dead depending on whenever
        // this suite happens to run.
        const capturedAt = new Date(Date.parse('2026-08-11T17:00:00Z')).toISOString();
        await insertSnapshot({ capturedAt, status: 'open' });
        await insertTravelTime('victor-jackson-eb', capturedAt, 38 * 60);
        await insertTravelTime('driggs-jackson-eb', capturedAt, 46 * 60);
        await insertTravelTime('victor-jackson-wb', capturedAt, 33 * 60);
        await insertTravelTime('driggs-jackson-wb', capturedAt, 41 * 60);

        try {
          // 2026-08-11T17:59:00Z = 11:59 MDT (pre-noon Denver) -- August is
          // DST (UTC-6), so this and the post-noon instant below straddle
          // the Denver noon boundary while staying on the SAME UTC day, a
          // deliberately narrow gap that would catch an off-by-one-hour or
          // UTC-instead-of-Denver bug.
          setTestNowMs(Date.parse('2026-08-11T17:59:00Z'));
          const preNoon = await get(`/embed/${variant}?dir=auto`);
          const preNoonHtml = await preNoon.text();
          expect(preNoonHtml).toMatch(/Victor → Jackson|Victor→JAC/);
          expect(preNoonHtml).toContain('utm_content=eb');

          setTestNowMs(Date.parse('2026-08-11T18:01:00Z')); // 12:01 MDT
          const postNoon = await get(`/embed/${variant}?dir=auto`);
          const postNoonHtml = await postNoon.text();
          expect(postNoonHtml).toMatch(/Jackson → Victor|JAC→Victor/);
          expect(postNoonHtml).toContain('utm_content=wb');
        } finally {
          setTestNowMs(undefined);
        }
      },
    );

    it('strip: HTML contains both full and compact time spans, and both breakpoints', async () => {
      const now = new Date().toISOString();
      await insertSnapshot({ capturedAt: now, status: 'open' });
      await insertTravelTime('victor-jackson-eb', now, 38 * 60);
      await insertTravelTime('driggs-jackson-eb', now, 46 * 60);

      const res = await get('/embed/strip');
      const html = await res.text();
      expect(html).toContain('strip-times-full');
      expect(html).toContain('strip-times-compact');
      expect(html).toContain('Victor → Jackson');
      expect(html).toContain('Victor→JAC');
      expect(html).toMatch(/max-width:\s*620px/);
      expect(html).toMatch(/max-width:\s*420px/);
    });

    it('cache canonicalization: ?dir=bogus&junk=1 shares the bare request\'s eb cache entry', async () => {
      await purgeEmbedCache('badge');

      await insertSnapshot({ capturedAt: new Date().toISOString(), status: 'open' });
      await insertTravelTime('victor-jackson-eb', new Date().toISOString(), 61 * 60);
      await insertTravelTime('driggs-jackson-eb', new Date().toISOString(), 62 * 60);

      const ctx1 = createExecutionContext();
      const first = await worker.fetch(
        new Request('https://tetonpasscam.com/embed/badge'),
        env as any,
        ctx1,
      );
      await waitOnExecutionContext(ctx1);
      const firstHtml = await first.text();
      expect(firstHtml).toContain('61 min');

      // Change the underlying data -- if ?dir=bogus&junk=1 built its own
      // cache key instead of sharing the canonical eb one, this second
      // request would recompute and show the NEW duration.
      await insertTravelTime('victor-jackson-eb', new Date().toISOString(), 99 * 60);

      const ctx2 = createExecutionContext();
      const second = await worker.fetch(
        new Request('https://tetonpasscam.com/embed/badge?dir=bogus&junk=1'),
        env as any,
        ctx2,
      );
      await waitOnExecutionContext(ctx2);
      const secondHtml = await second.text();

      expect(secondHtml).toBe(firstHtml);
      expect(secondHtml).toContain('61 min');
      expect(secondHtml).not.toContain('99 min');

      await purgeEmbedCache('badge');
    });
  });
});
