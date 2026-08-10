// Exercises the full real path (SEO audit fix #2): the top-level Worker
// `fetch` handler, ASSETS binding, and `caches.default` are all available
// together in the vitest-pool-workers environment (confirmed empirically --
// unlike test/worker/index.test.ts's www-redirect tests, which only need
// the ExecutionContext, this suite needs `env.ASSETS` to actually serve
// dist/index.html and `caches.default` to exercise the edge-caching path),
// so this hits `worker.fetch` end-to-end rather than unit-testing
// `injectLiveStatus` against a synthetic Response.
//
// Cache-key isolation: `caches.default` persists across tests within this
// file (fresh only per FILE, same as D1 -- see apply-migrations.ts's
// comment), so each test uses a distinct query string on `/` to get its own
// cache entry. `url.pathname === '/'` in src/worker/index.ts ignores the
// query string, so these all still exercise the homepage-injection path.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import worker from '../../src/worker/index';

const HOUR_MS = 3_600_000;

async function get(pathAndQuery: string): Promise<{ res: Response; text: string }> {
  const request = new Request(`https://tetonpasscam.com${pathAndQuery}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.clone().text();
  return { res, text };
}

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

async function insertStatusSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
  conditionText?: string | null;
  // Defaults to capturedAt (matching real poller rows, which almost always
  // carry one) -- pass `null` explicitly to exercise the no-report-time
  // reword, or a distinct value to exercise the "prefer WYDOT's own report
  // time" fix.
  wydotReportTime?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, ?, '[]', '[]', ?, 'primary')`,
  )
    .bind(
      overrides.capturedAt,
      overrides.status,
      overrides.conditionText ?? null,
      overrides.wydotReportTime === undefined ? overrides.capturedAt : overrides.wydotReportTime,
    )
    .run();
}

async function insertWeather(capturedAt: string, airF: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO weather_snapshots (captured_at, air_f, reported_at) VALUES (?, ?, ?)`,
  )
    .bind(capturedAt, airF, capturedAt)
    .run();
}

const MINUTE_MS = 60_000;

async function insertTravelTime(capturedAt: string, durationSec: number): Promise<void> {
  const id = await routeId('victor-jackson-eb');
  await env.DB.prepare(
    `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`,
  )
    .bind(id, capturedAt, durationSec)
    .run();
}

function extractLiveStatusDiv(html: string): string {
  const match = html.match(/<div data-live-status>.*?<\/div>/s);
  expect(match).not.toBeNull();
  return match![0];
}

// MUST run before any other test in this file inserts a status_snapshots
// row -- same reasoning as api-status.test.ts's "no snapshots at all" test.
describe('GET / with a completely empty DB', () => {
  it('serves 200 with the unavailable wording, no status word rendered as current', async () => {
    const { res, text } = await get('/?case=empty-db');
    expect(res.status).toBe(200);
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('temporarily unavailable');
    expect(block).toContain('Wyoming 511');
    expect(block).not.toMatch(/Teton Pass is/);
  });
});

describe('GET / — homepage live-status injection', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('fresh open snapshot + weather + travel time ⇒ open, condition text, temp, minutes all present', async () => {
    const now = Date.now();
    const capturedAt = new Date(now).toISOString();
    await insertStatusSnapshot({ capturedAt, status: 'open', conditionText: 'Road Open' });
    await insertWeather(capturedAt, 28.4);
    await insertTravelTime(capturedAt, 42 * 60);

    const { res, text } = await get('/?case=fresh-open');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, max-age=0, must-revalidate');
    // Fix wave: the underlying asset's constant validators must not survive
    // into the injected response (see the ETag/304 test below for why).
    expect(res.headers.get('ETag')).toBeNull();
    expect(res.headers.get('Last-Modified')).toBeNull();

    const block = extractLiveStatusDiv(text);
    expect(block).toContain('Teton Pass is open');
    expect(block).toContain('Road Open');
    expect(block).toContain('28°F');
    expect(block).toContain('42 minutes');
  });

  it('escapes a script-tag payload in conditionText (XSS regression pin)', async () => {
    const now = Date.now();
    const capturedAt = new Date(now).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'restricted',
      conditionText: '<script>alert(1)</script>',
    });

    const { text } = await get('/?case=xss');
    const block = extractLiveStatusDiv(text);
    expect(block).not.toContain('<script>');
    expect(block).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('closed status includes the legal do-not-attempt copy', async () => {
    const now = Date.now();
    const capturedAt = new Date(now).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'closed',
      conditionText: 'Closed for avalanche control',
    });

    const { text } = await get('/?case=closed');
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('Teton Pass is closed');
    expect(block).toContain('do not attempt');
    expect(block).toContain('$750 fine');
  });

  it('snapshot 3h old ⇒ unavailable wording, no status word rendered as current', async () => {
    const capturedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
    await insertStatusSnapshot({ capturedAt, status: 'open', conditionText: 'Road Open' });

    const { text } = await get('/?case=stale');
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('temporarily unavailable');
    expect(block).not.toMatch(/Teton Pass is/);
  });

  it('an unknown-status snapshot (even if fresh) is treated as unavailable, never rendered as a current word', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({ capturedAt, status: 'unknown', conditionText: null });

    const { text } = await get('/?case=unknown-status');
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('temporarily unavailable');
    expect(block).not.toMatch(/Teton Pass is/);
  });

  it('/privacy is not transformed -- no data-live-status div, ASSETS content untouched', async () => {
    const { res, text } = await get('/privacy');
    expect(res.status).toBe(200);
    expect(text).not.toContain('data-live-status');
  });

  it('caches the homepage response for 5 minutes: a second request for the same URL does not re-read D1', async () => {
    const now = Date.now();
    const capturedAt = new Date(now).toISOString();
    await insertStatusSnapshot({ capturedAt, status: 'open', conditionText: 'Road Open — cache test A' });

    const first = await get('/?case=cache-check');
    const firstBlock = extractLiveStatusDiv(first.text);
    expect(firstBlock).toContain('cache test A');

    // Insert a newer snapshot that WOULD change the rendered text if this
    // request actually re-read D1.
    const capturedAt2 = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({
      capturedAt: capturedAt2,
      status: 'closed',
      conditionText: 'Road Closed — cache test B',
    });

    const second = await get('/?case=cache-check');
    const secondBlock = extractLiveStatusDiv(second.text);
    expect(secondBlock).toContain('cache test A');
    expect(secondBlock).not.toContain('cache test B');
    expect(second.res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=300, max-age=0, must-revalidate',
    );
  });

  it('prefers wydotReportTime over capturedAt for the "as of" timestamp', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    // A distinctly different, still-fresh report time -- if the bug
    // regresses (capturedAt used instead), this exact hour/minute would
    // NOT appear in the rendered block.
    const reportTime = new Date(Date.now() - 37 * MINUTE_MS).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'open',
      conditionText: 'Road Open — report-time test',
      wydotReportTime: reportTime,
    });

    const { text } = await get('/?case=report-time');
    const block = extractLiveStatusDiv(text);
    const expectedTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(reportTime));
    expect(block).toContain(`as of ${expectedTime}`);
    expect(block).not.toContain('our last check');
  });

  it('reports "as of our last check" when wydotReportTime is null (crosscheck-sourced row)', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'open',
      conditionText: 'Road Open — no report time',
      wydotReportTime: null,
    });

    const { text } = await get('/?case=no-report-time');
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('as of our last check');
  });

  it('omits the temperature sentence when the newest weather row is stale (> WEATHER_STALE_MIN)', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'open',
      conditionText: 'Road Open — stale weather test',
    });
    const staleWeatherAt = new Date(Date.now() - 70 * MINUTE_MS).toISOString();
    await insertWeather(staleWeatherAt, 19.9);

    const { text } = await get('/?case=stale-weather');
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('Teton Pass is open');
    expect(block).not.toContain('°F');
  });

  it('a conditional request carrying the underlying asset\'s ETag still gets a fresh 200 with live-status content, not a stale 304', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'open',
      conditionText: 'Road Open — etag test',
    });

    // Learn the real, constant ETag of the underlying static asset by
    // asking ASSETS directly, bypassing our own worker logic entirely.
    const rawAssetRes = await env.ASSETS.fetch(
      new Request('https://tetonpasscam.com/?case=etag-check'),
    );
    const assetEtag = rawAssetRes.headers.get('ETag');
    expect(assetEtag).toBeTruthy();

    const request = new Request('https://tetonpasscam.com/?case=etag-check', {
      headers: { 'If-None-Match': assetEtag! },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const text = await res.text();
    const block = extractLiveStatusDiv(text);
    expect(block).toContain('etag test');
    expect(res.headers.get('ETag')).toBeNull();
  });
});
