import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { runForecastStep, FORECAST_REFRESH_MIN } from '../../src/worker/poller/nws-forecast';
import liveHourly from '../fixtures/nws-hourly.json';

/** A fetcher that serves the captured NWS payload and counts its calls. */
function fakeNws(): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(liveHourly), {
      status: 200,
      headers: { 'Content-Type': 'application/geo+json' },
    });
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

async function clearForecast() {
  await env.DB.prepare('DELETE FROM forecast_days').run();
}

describe('forecast_days table', () => {
  it('stores and reads back a day, upserting on date', async () => {
    await env.DB.prepare(
      `INSERT INTO forecast_days
         (date, high_f, low_f, category, icon_url, short_forecast, precip_pct, wind_gust_mph, fetched_at)
       VALUES ('2026-08-16', 62, 38, 'clear', 'https://x/few', 'Sunny', 10, 12, '2026-08-16T16:00:00.000Z')`,
    ).run();

    // Second write for the same date revises the row rather than duplicating.
    await env.DB.prepare(
      `INSERT INTO forecast_days
         (date, high_f, low_f, category, icon_url, short_forecast, precip_pct, wind_gust_mph, fetched_at)
       VALUES ('2026-08-16', 58, 35, 'snow', 'https://x/snow', 'Snow', 70, 20, '2026-08-16T17:00:00.000Z')
       ON CONFLICT(date) DO UPDATE SET
         high_f = excluded.high_f, low_f = excluded.low_f, category = excluded.category,
         icon_url = excluded.icon_url, short_forecast = excluded.short_forecast,
         precip_pct = excluded.precip_pct, wind_gust_mph = excluded.wind_gust_mph,
         fetched_at = excluded.fetched_at`,
    ).run();

    const rows = await env.DB.prepare('SELECT * FROM forecast_days').all();
    expect(rows.results).toHaveLength(1);
    expect((rows.results[0] as any).category).toBe('snow');
    expect((rows.results[0] as any).high_f).toBe(58);
  });

  it('allows every reading column to be null', async () => {
    await env.DB.prepare(
      `INSERT INTO forecast_days (date, category, fetched_at)
       VALUES ('2026-08-20', 'cloudy', '2026-08-16T16:00:00.000Z')`,
    ).run();
    const row = (await env.DB.prepare(
      "SELECT precip_pct, high_f FROM forecast_days WHERE date = '2026-08-20'",
    ).first()) as any;
    expect(row.precip_pct).toBeNull();
    expect(row.high_f).toBeNull();
  });
});

describe('runForecastStep', () => {
  it('writes daily rows and sends a descriptive User-Agent', async () => {
    await clearForecast();
    const fetcher = fakeNws();
    let sentUa: string | null = null;
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sentUa = new Headers(init?.headers).get('User-Agent');
      return fetcher(input, init);
    }) as typeof fetch;

    await runForecastStep(env as any, spy, Date.parse('2026-08-16T16:00:00.000Z'));

    const rows = await env.DB.prepare('SELECT * FROM forecast_days ORDER BY date').all();
    expect(rows.results.length).toBeGreaterThanOrEqual(6);
    expect(sentUa).toContain('tetonpasscam.com');
    expect(sentUa).toContain('@');
  });

  it('skips the fetch entirely inside the refresh window', async () => {
    await clearForecast();
    const fetcher = fakeNws();
    const t0 = Date.parse('2026-08-16T16:00:00.000Z');
    await runForecastStep(env as any, fetcher, t0);
    expect(fetcher.calls).toHaveLength(1);

    // 10 minutes later -- the next poll cycle -- must not re-fetch.
    await runForecastStep(env as any, fetcher, t0 + 10 * 60_000);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('re-fetches once the refresh window has elapsed, revising the same rows', async () => {
    await clearForecast();
    const fetcher = fakeNws();
    const t0 = Date.parse('2026-08-16T16:00:00.000Z');
    await runForecastStep(env as any, fetcher, t0);
    const firstCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first()) as any;

    await runForecastStep(env as any, fetcher, t0 + (FORECAST_REFRESH_MIN + 1) * 60_000);
    expect(fetcher.calls).toHaveLength(2);

    const secondCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first()) as any;
    expect(secondCount.n).toBe(firstCount.n); // upsert, not append
  });

  it('leaves the table untouched when NWS fails', async () => {
    await clearForecast();
    const failing = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    await runForecastStep(env as any, failing, Date.parse('2026-08-16T16:00:00.000Z'));
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first();
    expect((rows as any).n).toBe(0);
  });

  it('does not throw when NWS returns unparseable JSON', async () => {
    await clearForecast();
    const garbage = (async () => new Response('<html>nope</html>', { status: 200 })) as typeof fetch;
    await expect(
      runForecastStep(env as any, garbage, Date.parse('2026-08-16T16:00:00.000Z')),
    ).resolves.toBeUndefined();
  });

  it('re-resolves the grid when the hardcoded gridpoint 404s', async () => {
    // NWS occasionally re-grids, which retires an office/x/y triple. A 404
    // means "this cell no longer exists", not "no forecast" -- so fall back
    // to /points once rather than going dark until someone notices.
    await clearForecast();
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/gridpoints/RIW/35,140/')) {
        return new Response('not found', { status: 404 });
      }
      if (url.includes('/points/')) {
        return new Response(
          JSON.stringify({
            properties: {
              forecastHourly: 'https://api.weather.gov/gridpoints/RIW/36,141/forecast/hourly',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(liveHourly), { status: 200 });
    }) as typeof fetch;

    await runForecastStep(env as any, fetcher, Date.parse('2026-08-16T16:00:00.000Z'));

    expect(urls[0]).toContain('/gridpoints/RIW/35,140/');
    expect(urls[1]).toContain('/points/43.4986,-110.9564');
    expect(urls[2]).toContain('/gridpoints/RIW/36,141/');
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first();
    expect((rows as any).n).toBeGreaterThanOrEqual(6);
  });

  it('gives up rather than looping when the re-resolved grid also fails', async () => {
    await clearForecast();
    let pointsCalls = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/points/')) {
        pointsCalls++;
        return new Response(
          JSON.stringify({
            properties: {
              forecastHourly: 'https://api.weather.gov/gridpoints/RIW/36,141/forecast/hourly',
            },
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    await runForecastStep(env as any, fetcher, Date.parse('2026-08-16T16:00:00.000Z'));
    expect(pointsCalls).toBe(1); // exactly one re-resolve, never a retry loop
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first();
    expect((rows as any).n).toBe(0);
  });

  it('leaves every row untouched on a mid-write failure, then re-fetches next cycle instead of skipping', async () => {
    // A sequential per-day loop could leave some rows written with a fresh
    // fetchedAt and others not, which would make a genuinely failed cycle
    // look "fresh" to the throttle's MAX(fetched_at) check. The fix is a
    // single db.batch() so the whole write is all-or-nothing; this test
    // forces the underlying D1 batch call to fail and checks both halves of
    // that guarantee: (1) nothing was written, and (2) the next cycle still
    // sees the OLD fetchedAt and therefore refetches rather than skipping.
    await clearForecast();
    const oldFetchedAt = '2026-08-16T10:00:00.000Z';
    await env.DB.prepare(
      `INSERT INTO forecast_days (date, category, high_f, fetched_at)
       VALUES ('2026-08-16', 'clear', 50, ?)`,
    )
      .bind(oldFetchedAt)
      .run();

    const fetcher = fakeNws();
    const t0 = Date.parse('2026-08-16T16:00:00.000Z'); // 6h after oldFetchedAt, past the refresh window

    const batchSpy = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(runForecastStep(env as any, fetcher, t0)).rejects.toThrow('boom');
    batchSpy.mockRestore();

    // Nothing committed: the seeded row is exactly as it was.
    const afterFailure = await env.DB.prepare('SELECT * FROM forecast_days').all();
    expect(afterFailure.results).toHaveLength(1);
    expect((afterFailure.results[0] as any).category).toBe('clear');
    expect((afterFailure.results[0] as any).high_f).toBe(50);
    expect((afterFailure.results[0] as any).fetched_at).toBe(oldFetchedAt);

    // The actual bug under test: MAX(fetched_at) still reads the OLD
    // timestamp (nothing bumped it), so this next cycle must refetch rather
    // than silently skip inside the refresh window.
    await runForecastStep(env as any, fetcher, t0);
    const afterRetry = await env.DB.prepare('SELECT * FROM forecast_days ORDER BY date').all();
    expect(afterRetry.results.length).toBeGreaterThanOrEqual(6);
    const seededDay = afterRetry.results.find((r: any) => r.date === '2026-08-16') as any;
    expect(seededDay.fetched_at).not.toBe(oldFetchedAt);
  });
});

describe('forecast_hours table', () => {
  it('stores and reads back an hour, keyed on start_ms', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    await env.DB.prepare(
      `INSERT INTO forecast_hours
         (start_ms, start_time, temp_f, category, is_daytime, icon_url, short_forecast, precip_pct, fetched_at)
       VALUES (?, '2026-08-16T14:00:00-06:00', 66, 'thunderstorm', 1, 'https://x/tsra', 'Storms', 34, '2026-08-16T18:00:00.000Z')`,
    )
      .bind(Date.parse('2026-08-16T14:00:00-06:00'))
      .run();

    const row = (await env.DB.prepare('SELECT * FROM forecast_hours').first()) as any;
    expect(row.start_ms).toBe(Date.parse('2026-08-16T14:00:00-06:00'));
    expect(row.category).toBe('thunderstorm');
    expect(row.is_daytime).toBe(1);
  });

  it('allows every reading column to be null', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    await env.DB.prepare(
      `INSERT INTO forecast_hours (start_ms, start_time, category, is_daytime, fetched_at)
       VALUES (1, '2026-08-16T14:00:00-06:00', 'cloudy', 0, '2026-08-16T18:00:00.000Z')`,
    ).run();
    const row = (await env.DB.prepare('SELECT temp_f, precip_pct FROM forecast_hours').first()) as any;
    expect(row.temp_f).toBeNull();
    expect(row.precip_pct).toBeNull();
  });
});
