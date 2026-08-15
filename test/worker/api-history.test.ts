import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { getHistory } from '../../src/worker/api/history';
import { seedRoutes } from '../../src/worker/db/seed-routes';

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

async function insertTravelTime(routeId_: number, capturedAt: string, durationSec: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`,
  )
    .bind(routeId_, capturedAt, durationSec)
    .run();
}

beforeAll(async () => {
  await seedRoutes(env.DB);
});

describe('GET /api/history', () => {
  it('404s for an unknown slug', async () => {
    const res = await api.request('/history?route=not-a-real-route', {}, env as any);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('400s when the ?route= query param is missing entirely', async () => {
    const res = await api.request('/history', {}, env as any);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('happy path: returns route, typicals, and today for a known slug; sets Cache-Control', async () => {
    const slug = 'victor-tetonvillage-eb';
    const id = await routeId(slug);

    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, 'weekday', 7, 'winter', 1800, 1700, 1900)`,
    )
      .bind(id)
      .run();

    const capturedAt = new Date().toISOString(); // "now" is always within Denver-local "today"
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1750)`,
    )
      .bind(id, capturedAt)
      .run();

    const res = await api.request(`/history?route=${slug}`, {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');

    const body = (await res.json()) as {
      route: { slug: string; name: string };
      typicals: { weekdayClass: string; season: string; hour: number; medianSec: number | null }[];
      today: { capturedAt: string; durationSec: number }[];
    };
    expect(body.route.slug).toBe(slug);
    expect(body.typicals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ weekdayClass: 'weekday', hour: 7, season: 'winter', medianSec: 1800 }),
      ]),
    );
    expect(body.today).toEqual(
      expect.arrayContaining([expect.objectContaining({ capturedAt, durationSec: 1750 })]),
    );
  });
});

describe('getHistory — today window', () => {
  it('excludes a row from Denver-local yesterday and includes one from this morning, ascending', async () => {
    const slug = 'driggs-tetonvillage-eb';
    const id = await routeId(slug);

    // Fixed clock: 2026-01-15 10:00 America/Denver (MST, UTC-7) == 17:00 UTC.
    const FIXED_NOW_MS = Date.parse('2026-01-15T17:00:00.000Z');
    // Denver-local midnight for Jan 15 2026 (MST) == 07:00 UTC same day.
    // A row at Denver-local Jan 14 23:30 (yesterday) == Jan 15 06:30 UTC --
    // before the midnight boundary, so it must be excluded.
    const yesterdayAt = '2026-01-15T06:30:00.000Z';
    // A row at Denver-local Jan 15 08:00 (this morning) == Jan 15 15:00 UTC --
    // after the midnight boundary, so it must be included.
    const thisMorningAt = '2026-01-15T15:00:00.000Z';

    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1111)`,
    )
      .bind(id, yesterdayAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 2222)`,
    )
      .bind(id, thisMorningAt)
      .run();

    const result = await getHistory(env as any, slug, FIXED_NOW_MS);
    expect(result).not.toBeNull();
    expect(result!.today).toEqual([{ capturedAt: thisMorningAt, durationSec: 2222 }]);
  });

  it('returns 3+ same-Denver-day rows in ascending capturedAt order regardless of insertion order', async () => {
    const slug = 'victor-airport-wb';
    const id = await routeId(slug);

    // Same fixed clock as the previous test: Denver-local midnight for Jan
    // 15 2026 (MST) == 07:00 UTC that day.
    const FIXED_NOW_MS = Date.parse('2026-01-15T17:00:00.000Z');
    const earliest = '2026-01-15T08:00:00.000Z'; // 01:00 Denver
    const middle = '2026-01-15T12:00:00.000Z'; // 05:00 Denver
    const latest = '2026-01-15T16:00:00.000Z'; // 09:00 Denver

    // Inserted deliberately OUT of chronological order -- if the endpoint
    // ever relied on insertion/rowid order instead of an explicit ORDER BY
    // captured_at, this would catch it.
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 3333)`,
    )
      .bind(id, latest)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1111)`,
    )
      .bind(id, earliest)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 2222)`,
    )
      .bind(id, middle)
      .run();

    const result = await getHistory(env as any, slug, FIXED_NOW_MS);
    expect(result).not.toBeNull();
    expect(result!.today).toEqual([
      { capturedAt: earliest, durationSec: 1111 },
      { capturedAt: middle, durationSec: 2222 },
      { capturedAt: latest, durationSec: 3333 },
    ]);
  });
});

describe('GET /api/history — confidence fields', () => {
  it('passes sampleCount and distinctDays through per typical', async () => {
    // driggs-tetonvillage-eb, victor-airport-wb, and victor-tetonvillage-eb
    // are already seeded by the existing tests in this file -- storage
    // persists across tests within a file, so reusing them would mix their
    // route_typicals rows into these assertions.
    const slug = 'driggs-jackson-eb';
    const id = await routeId(slug);
    await env.DB.prepare(
      `INSERT INTO route_typicals
         (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
       VALUES (?, 'weekday', 9, 'summer', 1800, 1700, 1900, 30, 5)`,
    )
      .bind(id)
      .run();

    const result = await getHistory(env, slug, Date.parse('2026-08-15T18:00:00.000Z'));
    const bucket = result!.typicals.find((t) => t.hour === 9 && t.season === 'summer');
    expect(bucket?.sampleCount).toBe(30);
    expect(bucket?.distinctDays).toBe(5);
  });

  it('reports NULL confidence for pre-0002 rows rather than defaulting to 0', async () => {
    // 0 would read as a real measurement of "no days"; NULL is "unknown",
    // and the client gates on NULL the same way it gates on too-few days.
    const slug = 'driggs-airport-eb';
    const id = await routeId(slug);
    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, 'weekday', 9, 'summer', 1800, 1700, 1900)`,
    )
      .bind(id)
      .run();

    const result = await getHistory(env, slug, Date.parse('2026-08-15T18:00:00.000Z'));
    const bucket = result!.typicals.find((t) => t.hour === 9 && t.season === 'summer');
    expect(bucket?.distinctDays).toBeNull();
  });
});

describe('GET /api/history — summary', () => {
  const NOW = Date.parse('2026-08-15T18:00:00.000Z'); // 12:00 MDT, summer

  it('worstDays: top 3 per-day peaks, descending, grouped by DENVER day', async () => {
    const slug = 'victor-jackson-wb';
    const id = await routeId(slug);
    // Four Denver days with distinct peaks. The 2026-08-12 pair straddles
    // UTC midnight (03:00Z on the 13th is 21:00 MDT on the 12th) -- both
    // must land on 2026-08-12, and its peak must be the larger, 3000.
    await insertTravelTime(id, '2026-08-10T18:00:00.000Z', 1800);
    await insertTravelTime(id, '2026-08-11T18:00:00.000Z', 3600);
    await insertTravelTime(id, '2026-08-12T18:00:00.000Z', 2400);
    await insertTravelTime(id, '2026-08-13T03:00:00.000Z', 3000);
    await insertTravelTime(id, '2026-08-14T18:00:00.000Z', 2000);

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.worstDays).toEqual([
      { date: '2026-08-11', peakSec: 3600 },
      { date: '2026-08-12', peakSec: 3000 },
      { date: '2026-08-14', peakSec: 2000 },
    ]);
  });

  it('worstDays: excludes readings from a previous season', async () => {
    const slug = 'victor-tetonvillage-wb';
    const id = await routeId(slug);
    // Feb 2026 is the previous (winter) season; it must not appear in a
    // summer "this season" list even though it is the slowest reading.
    await insertTravelTime(id, '2026-02-10T19:00:00.000Z', 9999);
    await insertTravelTime(id, '2026-08-11T18:00:00.000Z', 1800);

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.worstDays).toEqual([{ date: '2026-08-11', peakSec: 1800 }]);
  });

  it('worstDays: null when the season has no readings at all', async () => {
    const result = await getHistory(env, 'driggs-jackson-wb', NOW);
    expect(result!.summary.worstDays).toBeNull();
  });

  it('seasonMedians: winter null under summer-only data', async () => {
    const slug = 'victor-airport-eb';
    const id = await routeId(slug);
    for (const [hour, median] of [
      [7, 1800],
      [8, 2400],
      [9, 3000],
    ]) {
      await env.DB.prepare(
        `INSERT INTO route_typicals
           (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
         VALUES (?, 'weekday', ?, 'summer', ?, 1700, 1900, 30, 5)`,
      )
        .bind(id, hour, median)
        .run();
    }

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.seasonMedians?.summer).toBe(2400);
    expect(result!.summary.seasonMedians?.winter).toBeNull();
  });

  it('closureDays: null when we have no snapshot coverage of a completed winter', async () => {
    // The site started recording in Aug 2026. The most recent completed
    // winter (Nov 2025 - Apr 2026) predates every snapshot we hold, so the
    // honest answer is "unknown" -- NOT 0, which would claim we watched
    // that winter and saw no closures.
    const result = await getHistory(env, 'driggs-airport-wb', NOW);
    expect(result!.summary.closureDays?.winter).toBeNull();
  });
});
