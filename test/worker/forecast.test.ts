import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

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
