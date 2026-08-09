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
