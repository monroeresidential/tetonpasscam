import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { getWeatherHistory } from '../../src/worker/api/weather-history';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM weather_typicals').run();
  await env.DB.prepare('DELETE FROM weather_snapshots').run();
});

describe('GET /api/weather-history', () => {
  it('returns typicals for every metric, with confidence fields', async () => {
    await env.DB.prepare(
      `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75, sample_count, distinct_days)
       VALUES ('air_f', 'weekday', 8, 'summer', 50, 45, 55, 30, 5)`,
    ).run();

    const result = await getWeatherHistory(env as any, Date.parse('2026-08-15T18:00:00.000Z'));
    const air = result.typicals.find((t) => t.metric === 'air_f' && t.hour === 8);
    expect(air?.median).toBe(50);
    expect(air?.distinctDays).toBe(5);
  });

  it('reports NULL confidence rather than 0 for a row that predates the columns', async () => {
    await env.DB.prepare(
      `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75)
       VALUES ('air_f', 'weekday', 9, 'summer', 50, 45, 55)`,
    ).run();

    const result = await getWeatherHistory(env as any, Date.parse('2026-08-15T18:00:00.000Z'));
    expect(result.typicals.find((t) => t.hour === 9)?.distinctDays).toBeNull();
  });

  it('today spans Denver-local midnight, not UTC midnight', async () => {
    const now = Date.parse('2026-08-15T18:00:00.000Z'); // 12:00 MDT Aug 15
    // 05:00Z Aug 15 == 23:00 MDT Aug 14 -- same UTC day as `now`, but the
    // PREVIOUS Denver day, so it must be excluded.
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, 40, 60)`,
    )
      .bind('2026-08-15T05:00:00.000Z')
      .run();
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, 55, 75)`,
    )
      .bind('2026-08-15T17:00:00.000Z')
      .run();

    const result = await getWeatherHistory(env as any, now);
    expect(result.today).toHaveLength(1);
    expect(result.today[0].airF).toBe(55);
  });

  it('serves over HTTP with a Cache-Control header', async () => {
    const res = await api.request('/weather-history', {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeTruthy();
    const body = (await res.json()) as { typicals: unknown[]; today: unknown[] };
    expect(Array.isArray(body.typicals)).toBe(true);
    expect(Array.isArray(body.today)).toBe(true);
  });
});
