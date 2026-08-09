import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import { runNightly } from '../../src/worker/poller/aggregate';

const DAY_MS = 24 * 3_600_000;

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

async function typicalsFor(
  routeId_: number,
  weekdayClass: string,
  hour: number,
  season: string,
): Promise<{ medianSec: number; p25Sec: number; p75Sec: number } | undefined> {
  return (await env.DB.prepare(
    `SELECT median_sec AS medianSec, p25_sec AS p25Sec, p75_sec AS p75Sec
       FROM route_typicals WHERE route_id = ? AND weekday_class = ? AND hour = ? AND season = ?`,
  )
    .bind(routeId_, weekdayClass, hour, season)
    .first()) as { medianSec: number; p25Sec: number; p75Sec: number } | undefined;
}

beforeAll(async () => {
  await seedRoutes(env.DB);
});

describe('runNightly — typicals rebuild', () => {
  it(
    // Nearest-rank convention (documented in aggregate.ts alongside
    // `nearestRank`): for a sorted ascending array of n values, the p-th
    // percentile is at 1-based rank ceil(p/100 * n), i.e. 0-based index
    // ceil(p/100 * n) - 1. For n=5 durations [1800,1900,2000,2100,2200]:
    //   p50 -> rank ceil(2.5)=3 -> index 2 -> 2000
    //   p25 -> rank ceil(1.25)=2 -> index 1 -> 1900
    //   p75 -> rank ceil(3.75)=4 -> index 3 -> 2100
    'known distribution ⇒ median 2000, p25 1900, p75 2100 (nearest-rank)',
    async () => {
      const id = await routeId('victor-jackson-eb');
      // 2026-01-14 is a Wednesday; 07:00 MST (America/Denver, UTC-7 in
      // January) == 14:00 UTC same day -- weekday, hour 7, winter.
      const durations = [1800, 1900, 2000, 2100, 2200];
      for (let i = 0; i < durations.length; i++) {
        await insertTravelTime(id, `2026-01-14T14:0${i}:00.000Z`, durations[i]);
      }

      await runNightly(env as any, Date.parse('2026-01-14T14:10:00.000Z'));

      const row = await typicalsFor(id, 'weekday', 7, 'winter');
      expect(row).toEqual({ medianSec: 2000, p25Sec: 1900, p75Sec: 2100 });
    },
  );

  it('is idempotent: running twice produces identical rowcount and rows', async () => {
    const id = await routeId('driggs-jackson-eb');
    await insertTravelTime(id, '2026-02-10T14:00:00.000Z', 1500); // Tue, 07:00 MST, winter
    await insertTravelTime(id, '2026-02-10T15:00:00.000Z', 1600); // Tue, 08:00 MST, winter

    const nowMs = Date.parse('2026-02-10T16:00:00.000Z');
    await runNightly(env as any, nowMs);
    const firstPass = (
      await env.DB.prepare('SELECT * FROM route_typicals ORDER BY route_id, weekday_class, hour, season').all()
    ).results;

    await runNightly(env as any, nowMs);
    const secondPass = (
      await env.DB.prepare('SELECT * FROM route_typicals ORDER BY route_id, weekday_class, hour, season').all()
    ).results;

    expect(secondPass).toEqual(firstPass);
    expect(secondPass.length).toBe(firstPass.length);
  });
});

describe('runNightly — retention', () => {
  const NOW_MS = Date.parse('2026-08-09T12:00:00.000Z');
  // Calendar-based cutoff: exactly 2 years before NOW_MS (matches the
  // implementation's UTC-full-year subtraction, not a fixed 730-day count).
  const CUTOFF_MS = Date.parse('2024-08-09T12:00:00.000Z');

  it('prunes status/weather/detour snapshots older than 2y but keeps rows within 2y-1day, and never touches travel_times', async () => {
    const keptAt = new Date(CUTOFF_MS + DAY_MS).toISOString(); // ~2y - 1 day old -> kept
    const prunedAt = new Date(CUTOFF_MS - DAY_MS).toISOString(); // ~2y + 1 day old -> pruned

    await env.DB.prepare(
      `INSERT INTO status_snapshots (captured_at, status) VALUES (?, 'open')`,
    )
      .bind(keptAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO status_snapshots (captured_at, status) VALUES (?, 'open')`,
    )
      .bind(prunedAt)
      .run();
    await env.DB.prepare(`INSERT INTO weather_snapshots (captured_at) VALUES (?)`).bind(keptAt).run();
    await env.DB.prepare(`INSERT INTO weather_snapshots (captured_at) VALUES (?)`).bind(prunedAt).run();
    await env.DB.prepare(`INSERT INTO detour_snapshots (captured_at) VALUES (?)`).bind(keptAt).run();
    await env.DB.prepare(`INSERT INTO detour_snapshots (captured_at) VALUES (?)`).bind(prunedAt).run();

    const id = await routeId('victor-airport-eb');
    await insertTravelTime(id, prunedAt, 1234); // travel_times NEVER pruned, even when very old
    const travelCountBefore = (
      (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first()) as any
    ).n as number;

    await runNightly(env as any, NOW_MS);

    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM status_snapshots WHERE captured_at = ?').bind(keptAt).first()) as any)
        .n,
    ).toBe(1);
    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM status_snapshots WHERE captured_at = ?').bind(prunedAt).first()) as any)
        .n,
    ).toBe(0);
    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM weather_snapshots WHERE captured_at = ?').bind(keptAt).first()) as any)
        .n,
    ).toBe(1);
    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM weather_snapshots WHERE captured_at = ?').bind(prunedAt).first()) as any)
        .n,
    ).toBe(0);
    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM detour_snapshots WHERE captured_at = ?').bind(keptAt).first()) as any)
        .n,
    ).toBe(1);
    expect(
      ((await env.DB.prepare('SELECT COUNT(*) n FROM detour_snapshots WHERE captured_at = ?').bind(prunedAt).first()) as any)
        .n,
    ).toBe(0);

    const travelCountAfter = (
      (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first()) as any
    ).n as number;
    expect(travelCountAfter).toBe(travelCountBefore); // untouched
  });

  it('flips an expired active alert to status=expired but leaves an active future alert untouched', async () => {
    const expiredAt = new Date(NOW_MS - 60_000).toISOString(); // expires_at in the past
    const futureAt = new Date(NOW_MS + 3_600_000).toISOString(); // expires_at in the future

    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, device_hash, status)
       VALUES (?, ?, 'closure', 'device-expired', 'active')`,
    )
      .bind(new Date(NOW_MS - 7_200_000).toISOString(), expiredAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, device_hash, status)
       VALUES (?, ?, 'closure', 'device-future', 'active')`,
    )
      .bind(new Date(NOW_MS).toISOString(), futureAt)
      .run();

    await runNightly(env as any, NOW_MS);

    const expiredRow = (await env.DB.prepare(
      `SELECT status FROM alerts WHERE device_hash = 'device-expired'`,
    ).first()) as { status: string };
    expect(expiredRow.status).toBe('expired');

    const futureRow = (await env.DB.prepare(
      `SELECT status FROM alerts WHERE device_hash = 'device-future'`,
    ).first()) as { status: string };
    expect(futureRow.status).toBe('active');
  });
});
