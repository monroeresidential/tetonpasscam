import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import { runNightly } from '../../src/worker/poller/aggregate';
import { denverParts } from '../../src/worker/tz';

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

  it(
    // Same formula, even-sized group (n=4) so the ceil() rounding actually
    // bites (odd n=5 above lands on exact integer ranks without exercising
    // the rounding-up behavior an even n does):
    //   p50 -> rank ceil(2)=2   -> index 1 -> 2000
    //   p25 -> rank ceil(1)=1   -> index 0 -> 1000
    //   p75 -> rank ceil(3)=3   -> index 2 -> 3000
    'even-sized group (n=4) ⇒ median 2000, p25 1000, p75 3000 (nearest-rank)',
    async () => {
      const id = await routeId('victor-tetonvillage-wb');
      // 2026-01-21 is also a Wednesday (one week after the n=5 test's Jan
      // 14); 09:00 MST == 16:00 UTC -- weekday, hour 9, winter.
      const durations = [1000, 2000, 3000, 4000];
      for (let i = 0; i < durations.length; i++) {
        await insertTravelTime(id, `2026-01-21T16:0${i}:00.000Z`, durations[i]);
      }

      await runNightly(env as any, Date.parse('2026-01-21T16:10:00.000Z'));

      const row = await typicalsFor(id, 'weekday', 9, 'winter');
      expect(row).toEqual({ medianSec: 2000, p25Sec: 1000, p75Sec: 3000 });
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

describe('runNightly — typicals window (audit finding 6, bounded aggregation)', () => {
  // Distinct routes from every other test in this file, so each test's
  // single seeded row is the *only* travel_times row for that route -- if
  // the rebuild wrongly includes/excludes it, the group's presence/absence
  // (or its median) is unambiguous, with no other row in the same bucket
  // to mask the bug.
  const NOW_MS = Date.parse('2026-08-10T18:00:00.000Z');

  it('excludes a travel_times row older than the 365-day window (400d old)', async () => {
    const id = await routeId('driggs-tetonvillage-wb');
    const oldCapturedAt = new Date(NOW_MS - 400 * DAY_MS).toISOString();
    // Distinct/extreme duration: if this row leaked into the rebuild despite
    // being outside the window, it would be the sole member of its group and
    // show up directly as that group's median.
    await insertTravelTime(id, oldCapturedAt, 9999);

    await runNightly(env as any, NOW_MS);

    const dims = denverParts(Date.parse(oldCapturedAt));
    const row = await typicalsFor(id, dims.weekdayClass, dims.hour, dims.season);
    expect(row).toBeFalsy(); // sole contributing row is outside the window -> no group at all (D1's .first() returns null, not undefined)
  });

  it('includes a travel_times row 364 days old (just inside the 365-day window)', async () => {
    const id = await routeId('driggs-tetonvillage-eb');
    const keptCapturedAt = new Date(NOW_MS - 364 * DAY_MS).toISOString();
    await insertTravelTime(id, keptCapturedAt, 4242);

    await runNightly(env as any, NOW_MS);

    const dims = denverParts(Date.parse(keptCapturedAt));
    const row = await typicalsFor(id, dims.weekdayClass, dims.hour, dims.season);
    expect(row).toEqual({ medianSec: 4242, p25Sec: 4242, p75Sec: 4242 });
  });
});

async function confidenceFor(
  routeId_: number,
  weekdayClass: string,
  hour: number,
  season: string,
): Promise<{ sampleCount: number; distinctDays: number } | undefined> {
  return (await env.DB.prepare(
    `SELECT sample_count AS sampleCount, distinct_days AS distinctDays
       FROM route_typicals WHERE route_id = ? AND weekday_class = ? AND hour = ? AND season = ?`,
  )
    .bind(routeId_, weekdayClass, hour, season)
    .first()) as { sampleCount: number; distinctDays: number } | undefined;
}

// Slug choice matters: runNightly rebuilds EVERY route from EVERY
// travel_times row in the shared test DB, so a slug another test in this
// file already seeded would inflate these counts. driggs-airport-{eb,wb}
// are the only pair untouched by the existing tests here.
describe('runNightly — confidence columns', () => {
  it('counts samples and DISTINCT Denver days separately', async () => {
    const id = await routeId('driggs-airport-eb');
    // Six readings in the 08:00 MDT hour, but spread over only TWO Denver
    // days: 2026-08-11 (Tue) and 2026-08-12 (Wed). This is exactly the
    // shape the gate exists to catch -- a healthy-looking sample count
    // standing on almost no day-to-day evidence.
    // 14:00 UTC == 08:00 MDT (UTC-6) in August.
    for (const min of ['00', '10', '20']) {
      await insertTravelTime(id, `2026-08-11T14:${min}:00.000Z`, 1800);
      await insertTravelTime(id, `2026-08-12T14:${min}:00.000Z`, 1900);
    }

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const conf = await confidenceFor(id, 'weekday', 8, 'summer');
    expect(conf?.sampleCount).toBe(6);
    expect(conf?.distinctDays).toBe(2);
  });

  it('resolves the hour bucket by Denver wall-clock, deduping same-day readings to one distinct day', async () => {
    const id = await routeId('driggs-airport-wb');
    // Both readings are 22:00-22:59 MDT on 2026-08-11 -- i.e. hour 22,
    // Denver-local -- but both raw capturedAt instants fall on 2026-08-12
    // in UTC (04:00 MDT == 22:00 the prior Denver day + 6h offset). A
    // naive `capturedAt.slice(0, 10)` UTC-day grouping happens to agree
    // here (both say "2026-08-12"), so this pins the correct single-day
    // answer rather than exercising a divergence -- a whole-hour-offset
    // zone like America/Denver can't split one Denver-hour bucket across
    // two UTC calendar dates, so no fixture can force real disagreement
    // between the two groupings within a single hour/day bucket.
    await insertTravelTime(id, '2026-08-12T04:10:00.000Z', 2000);
    await insertTravelTime(id, '2026-08-12T04:50:00.000Z', 2100);

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const conf = await confidenceFor(id, 'weekday', 22, 'summer');
    expect(conf?.sampleCount).toBe(2);
    expect(conf?.distinctDays).toBe(1);
  });
});

async function weatherTypicalFor(
  metric: string,
  weekdayClass: string,
  hour: number,
  season: string,
): Promise<{ median: number; p25: number; p75: number; sampleCount: number; distinctDays: number } | undefined> {
  return (await env.DB.prepare(
    `SELECT median, p25, p75, sample_count AS sampleCount, distinct_days AS distinctDays
       FROM weather_typicals WHERE metric = ? AND weekday_class = ? AND hour = ? AND season = ?`,
  )
    .bind(metric, weekdayClass, hour, season)
    .first()) as any;
}

async function insertWeather(capturedAt: string, airF: number, surfaceF: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, ?, ?)`,
  )
    .bind(capturedAt, airF, surfaceF)
    .run();
}

describe('runNightly — weather typicals', () => {
  it('aggregates each metric into its own rows, with per-bucket confidence', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    // Five readings in the 08:00 MDT hour spread over TWO Denver days --
    // high sample count standing on very little day-to-day evidence, the
    // exact shape the distinct-days gate exists to catch.
    // 14:00 UTC == 08:00 MDT (UTC-6) in August.
    for (const min of ['00', '10', '20']) {
      await insertWeather(`2026-08-11T14:${min}:00.000Z`, 50, 70);
    }
    for (const min of ['00', '10']) {
      await insertWeather(`2026-08-12T14:${min}:00.000Z`, 60, 80);
    }

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const air = await weatherTypicalFor('air_f', 'weekday', 8, 'summer');
    expect(air?.sampleCount).toBe(5);
    expect(air?.distinctDays).toBe(2);
    // nearest-rank p50 of [50,50,50,60,60] -> index ceil(2.5)-1 = 2 -> 50
    expect(air?.median).toBe(50);

    // Surface is a SEPARATE row, not a column on the air row.
    const surface = await weatherTypicalFor('surface_f', 'weekday', 8, 'summer');
    expect(surface?.median).toBe(70);
    expect(surface?.sampleCount).toBe(5);
  });

  it('skips null readings rather than counting them as samples', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, ?, NULL)`,
    )
      .bind('2026-08-11T15:00:00.000Z', 55)
      .run();

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    expect((await weatherTypicalFor('air_f', 'weekday', 9, 'summer'))?.sampleCount).toBe(1);
    // A null surface reading must not produce a surface row at all -- a row
    // with sampleCount 0 would claim we measured something.
    expect(await weatherTypicalFor('surface_f', 'weekday', 9, 'summer')).toBeFalsy();
  });

  it('rebuilds from scratch, leaving no stale rows behind', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await insertWeather('2026-08-11T16:00:00.000Z', 45, 65);
    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));
    expect(await weatherTypicalFor('air_f', 'weekday', 10, 'summer')).toBeTruthy();

    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await insertWeather('2026-08-11T17:00:00.000Z', 45, 65);
    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));
    expect(await weatherTypicalFor('air_f', 'weekday', 10, 'summer')).toBeFalsy();
    expect(await weatherTypicalFor('air_f', 'weekday', 11, 'summer')).toBeTruthy();
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

  it('leaves an already-removed alert as removed, even though its expires_at is in the past', async () => {
    const expiredAt = new Date(NOW_MS - 60_000).toISOString();

    // A moderator-removed alert (status='removed', Task 10 territory, out of
    // this job's scope) whose expires_at also happens to be in the past --
    // the retention UPDATE filters on status='active', so this row must
    // never flip to 'expired' and must never be resurrected to 'active'.
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, device_hash, status)
       VALUES (?, ?, 'closure', 'device-removed', 'removed')`,
    )
      .bind(new Date(NOW_MS - 7_200_000).toISOString(), expiredAt)
      .run();
    // Alongside a normal active+expired alert, so this test also confirms
    // the removed row's presence doesn't block the active row's flip.
    await env.DB.prepare(
      `INSERT INTO alerts (created_at, expires_at, type, device_hash, status)
       VALUES (?, ?, 'closure', 'device-expired-2', 'active')`,
    )
      .bind(new Date(NOW_MS - 7_200_000).toISOString(), expiredAt)
      .run();

    await runNightly(env as any, NOW_MS);

    const removedRow = (await env.DB.prepare(
      `SELECT status FROM alerts WHERE device_hash = 'device-removed'`,
    ).first()) as { status: string };
    expect(removedRow.status).toBe('removed');

    const activeExpiredRow = (await env.DB.prepare(
      `SELECT status FROM alerts WHERE device_hash = 'device-expired-2'`,
    ).first()) as { status: string };
    expect(activeExpiredRow.status).toBe('expired');
  });
});
