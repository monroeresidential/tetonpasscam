import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { denverTypicalsKey, setTestNowMs } from '../../src/worker/api/status';
import { seedRoutes } from '../../src/worker/db/seed-routes';
import { setTestEmailFetcher } from '../../src/worker/notify';
import { formatShareCode } from '../../src/worker/share-code';
import type { ApiStatus } from '../../src/shared/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

async function insertStatusSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
  conditionText?: string | null;
  advisories?: string[];
  restrictions?: string[];
  wydotReportTime?: string | null;
  source?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      overrides.capturedAt,
      overrides.status,
      overrides.conditionText ?? null,
      JSON.stringify(overrides.advisories ?? []),
      JSON.stringify(overrides.restrictions ?? []),
      overrides.wydotReportTime ?? null,
      overrides.source ?? 'primary',
    )
    .run();
}

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

async function getStatus(): Promise<{ res: Response; body: ApiStatus }> {
  const res = await api.request('/status', {}, env as any);
  const body = (await res.json()) as ApiStatus;
  return { res, body };
}

// This test MUST run before any other test in this file inserts a
// status_snapshots row -- vitest-pool-workers shares one D1 instance across
// every test in a file (fresh only per FILE, per apply-migrations.ts), so
// this is the only point at which the table is guaranteed empty.
describe('GET /api/status — no snapshots at all', () => {
  it('reports unknown + pollerDead with no lastConfirmed', async () => {
    const { body } = await getStatus();
    expect(body.status).toBe('unknown');
    expect(body.pollerDead).toBe(true);
    expect(body.lastConfirmed).toBeNull();
    // share-cards T1: nothing to share when there's no snapshot at all.
    expect(body.shareCode).toBeNull();
  });
});

describe('GET /api/status', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('fresh open snapshot ⇒ open, not dead, not stale; sets Cache-Control', async () => {
    const now = Date.now();
    await insertStatusSnapshot({
      capturedAt: new Date(now).toISOString(),
      status: 'open',
      conditionText: 'Road Open',
      wydotReportTime: new Date(now).toISOString(),
    });

    const { res, body } = await getStatus();
    expect(body.status).toBe('open');
    expect(body.pollerDead).toBe(false);
    expect(body.isStale).toBe(false);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    // generatedAt (final review fix wave #2): present, well-formed, and
    // recent -- it's the server's own "produced at" timestamp, stamped from
    // request-time `Date.now()` rather than any snapshot column, so it
    // should always read as "now" regardless of snapshot age.
    expect(body.generatedAt).toBeTruthy();
    const generatedAgeMs = Date.now() - Date.parse(body.generatedAt);
    expect(generatedAgeMs).toBeGreaterThanOrEqual(0);
    expect(generatedAgeMs).toBeLessThan(5_000);
  });

  it('newest snapshot 3h old ⇒ status forced unknown, pollerDead true, lastConfirmed preserves the open row', async () => {
    const capturedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
    await insertStatusSnapshot({
      capturedAt,
      status: 'open',
      wydotReportTime: capturedAt,
    });

    const { body } = await getStatus();
    expect(body.status).toBe('unknown');
    expect(body.pollerDead).toBe(true);
    expect(body.lastConfirmed).toEqual({ status: 'open', at: capturedAt });
    // share-cards T1: a dead-poller "current" view has nothing current to
    // share, even though a (now-ancient) snapshot row exists.
    expect(body.shareCode).toBeNull();
  });

  it('fresh snapshot ⇒ shareCode is that snapshot\'s own captured_at, formatted', async () => {
    const capturedAt = new Date(Date.now()).toISOString();
    await insertStatusSnapshot({ capturedAt, status: 'open', wydotReportTime: capturedAt });

    const { body } = await getStatus();
    expect(body.shareCode).toBe(formatShareCode(capturedAt));
  });

  it('wydotReportTime 13h old but snapshot fresh ⇒ status unchanged, isStale true', async () => {
    const now = Date.now();
    await insertStatusSnapshot({
      capturedAt: new Date(now).toISOString(),
      status: 'open',
      wydotReportTime: new Date(now - 13 * HOUR_MS).toISOString(),
    });

    const { body } = await getStatus();
    expect(body.status).toBe('open');
    expect(body.pollerDead).toBe(false);
    expect(body.isStale).toBe(true);
  });

  describe('isStale (LH T2 finding 3 -- missing/invalid/future wydotReportTime)', () => {
    it('wydotReportTime null on a non-unknown snapshot ⇒ isStale true (missing time is untrustworthy, not fresh)', async () => {
      await insertStatusSnapshot({
        capturedAt: new Date().toISOString(),
        status: 'closed',
        wydotReportTime: null,
      });

      const { body } = await getStatus();
      expect(body.status).toBe('closed');
      expect(body.isStale).toBe(true);
    });

    it('wydotReportTime unparseable on a non-unknown snapshot ⇒ isStale true', async () => {
      await insertStatusSnapshot({
        capturedAt: new Date().toISOString(),
        status: 'open',
        wydotReportTime: 'not-a-date',
      });

      const { body } = await getStatus();
      expect(body.status).toBe('open');
      expect(body.isStale).toBe(true);
    });

    it('wydotReportTime 20 minutes in the future ⇒ isStale true (beyond the 15min clock-skew tolerance)', async () => {
      const now = Date.now();
      await insertStatusSnapshot({
        capturedAt: new Date(now).toISOString(),
        status: 'open',
        wydotReportTime: new Date(now + 20 * 60_000).toISOString(),
      });

      const { body } = await getStatus();
      expect(body.status).toBe('open');
      expect(body.isStale).toBe(true);
    });

    it('wydotReportTime 10 minutes in the future ⇒ isStale false (within the 15min clock-skew tolerance)', async () => {
      const now = Date.now();
      await insertStatusSnapshot({
        capturedAt: new Date(now).toISOString(),
        status: 'open',
        wydotReportTime: new Date(now + 10 * 60_000).toISOString(),
      });

      const { body } = await getStatus();
      expect(body.status).toBe('open');
      expect(body.isStale).toBe(false);
    });

    it('newest snapshot is unknown (e.g. an unresolved disagreement) ⇒ isStale stays false, even with no wydotReportTime -- nothing to be stale about', async () => {
      await insertStatusSnapshot({
        capturedAt: new Date().toISOString(),
        status: 'unknown',
        wydotReportTime: null,
      });

      const { body } = await getStatus();
      expect(body.status).toBe('unknown');
      expect(body.isStale).toBe(false);
    });

    it('a crosscheck-sourced row (always null wydotReportTime) now correctly presents as stale', async () => {
      await insertStatusSnapshot({
        capturedAt: new Date().toISOString(),
        status: 'closed',
        wydotReportTime: null,
        source: 'crosscheck',
      });

      const { body } = await getStatus();
      expect(body.status).toBe('closed');
      expect(body.isStale).toBe(true);
    });
  });

  it('unknown snapshot (fresh) ⇒ lastConfirmed still reports the older open row', async () => {
    const now = Date.now();
    const olderOpenAt = new Date(now - 30 * 60_000).toISOString();
    await insertStatusSnapshot({ capturedAt: olderOpenAt, status: 'open' });
    await insertStatusSnapshot({ capturedAt: new Date(now).toISOString(), status: 'unknown' });

    const { body } = await getStatus();
    expect(body.status).toBe('unknown');
    expect(body.pollerDead).toBe(false);
    expect(body.lastConfirmed).toEqual({ status: 'open', at: olderOpenAt });
  });

  it('omits routes with no travel_times history and includes exactly the ones seeded', async () => {
    // Placed before any other test in this file touches travel_times, so
    // the table is guaranteed to hold only what this test itself inserts --
    // otherwise "exactly N routes" couldn't be asserted against a table
    // that accumulates rows across tests within the same D1 instance (this
    // file's D1 is fresh only once per FILE, per apply-migrations.ts).
    const seededSlugs = ['victor-tetonvillage-eb', 'driggs-tetonvillage-eb', 'victor-airport-eb'];
    const capturedAt = new Date().toISOString();
    for (const slug of seededSlugs) {
      const id = await routeId(slug);
      await env.DB.prepare(
        `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1234)`,
      )
        .bind(id, capturedAt)
        .run();
    }

    const { body } = await getStatus();
    expect(body.travelTimes).toHaveLength(seededSlugs.length);
    expect(body.travelTimes.map((t) => t.slug).sort()).toEqual([...seededSlugs].sort());
    // A route that was seeded with routes but never given a travel_times
    // row must not appear -- there's no valid placeholder for a
    // non-nullable durationSec.
    expect(body.travelTimes.some((t) => t.slug === 'driggs-airport-wb')).toBe(false);
  });

  it('travel_times freshness (LH T2 finding 4): a route whose latest row is 31 minutes old is omitted entirely', async () => {
    // Distinct, previously-untouched slug -- this file's D1 instance is
    // shared across tests, so reusing a slug another test already inserted
    // rows for would make "omitted" ambiguous with "just never had a row".
    const id = await routeId('driggs-airport-eb');
    const staleAt = new Date(Date.now() - 31 * 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1234)`,
    )
      .bind(id, staleAt)
      .run();

    const { body } = await getStatus();
    expect(body.travelTimes.some((t) => t.slug === 'driggs-airport-eb')).toBe(false);
  });

  it('travel_times freshness (LH T2 finding 4): a route whose latest row is 29 minutes old is still included', async () => {
    const id = await routeId('driggs-tetonvillage-wb');
    const freshAt = new Date(Date.now() - 29 * 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1234)`,
    )
      .bind(id, freshAt)
      .run();

    const { body } = await getStatus();
    expect(body.travelTimes.some((t) => t.slug === 'driggs-tetonvillage-wb')).toBe(true);
  });

  it('travel time typical: < 14 days of history ⇒ typicalSec null', async () => {
    // Fresh open snapshot so this request isn't degraded to pollerDead by an
    // earlier test's stale row.
    await insertStatusSnapshot({ capturedAt: new Date().toISOString(), status: 'open' });

    const id = await routeId('victor-jackson-eb');
    const { weekdayClass, hour, season } = denverTypicalsKey(Date.now());
    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, ?, ?, ?, 1800, 1700, 1900)`,
    )
      .bind(id, weekdayClass, hour, season)
      .run();

    const oldestAt = new Date(Date.now() - 5 * DAY_MS).toISOString(); // < 14 days
    const latestAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1500)`,
    )
      .bind(id, oldestAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1600)`,
    )
      .bind(id, latestAt)
      .run();

    const { body } = await getStatus();
    const entry = body.travelTimes.find((t) => t.slug === 'victor-jackson-eb');
    expect(entry).toBeTruthy();
    expect(entry!.durationSec).toBe(1600);
    expect(entry!.typicalSec).toBeNull();
  });

  it('travel time typical: ≥ 14 days of history + matching route_typicals row ⇒ typicalSec number', async () => {
    await insertStatusSnapshot({ capturedAt: new Date().toISOString(), status: 'open' });

    const id = await routeId('driggs-jackson-eb');
    const { weekdayClass, hour, season } = denverTypicalsKey(Date.now());
    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, ?, ?, ?, 1800, 1700, 1900)`,
    )
      .bind(id, weekdayClass, hour, season)
      .run();

    const oldestAt = new Date(Date.now() - 20 * DAY_MS).toISOString(); // ≥ 14 days
    const latestAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1500)`,
    )
      .bind(id, oldestAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1650)`,
    )
      .bind(id, latestAt)
      .run();

    const { body } = await getStatus();
    const entry = body.travelTimes.find((t) => t.slug === 'driggs-jackson-eb');
    expect(entry).toBeTruthy();
    expect(entry!.durationSec).toBe(1650);
    expect(entry!.typicalSec).toBe(1800);
  });

  it('derives weekday-class/hour/season from America/Denver, not UTC, at a day-boundary instant', async () => {
    // Sat Jan 17 2026 23:30 MST (America/Denver, standard time, UTC-7) is
    // Sun Jan 18 2026 06:30 UTC -- a UTC-vs-Denver day-of-week mismatch. If
    // the typicals lookup ever computed weekday/hour/season from UTC fields
    // instead of America/Denver ones, it would derive weekday='Sun'/hour=6
    // (weekday, not weekend) instead of the correct weekend/hour=23, miss
    // the seeded route_typicals row below, and this test would see
    // typicalSec:null instead of the seeded value.
    const FIXED_NOW_MS = Date.parse('2026-01-18T06:30:00.000Z');
    const slug = 'driggs-airport-wb';
    const id = await routeId(slug);

    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, 'weekend', 23, 'winter', 2222, 2100, 2300)`,
    )
      .bind(id)
      .run();

    const oldestAt = new Date(FIXED_NOW_MS - 20 * DAY_MS).toISOString(); // ≥ 14 days before FIXED_NOW_MS
    const latestAt = new Date(FIXED_NOW_MS - 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1500)`,
    )
      .bind(id, oldestAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, 1700)`,
    )
      .bind(id, latestAt)
      .run();

    setTestNowMs(FIXED_NOW_MS);
    try {
      const { body } = await getStatus();
      const entry = body.travelTimes.find((t) => t.slug === slug);
      expect(entry).toBeTruthy();
      expect(entry!.typicalSec).toBe(2222);
    } finally {
      // MUST clear: this is a module-level override shared by every
      // subsequent test in this file/worker instance.
      setTestNowMs(undefined);
    }
  });

  it('alerts is [] when there are no active alerts', async () => {
    const { body } = await getStatus();
    expect(body.alerts).toEqual([]);
  });

  it('a posted community alert appears in alerts[] without altering status/pollerDead/isStale', async () => {
    // Fresh open snapshot so this request's status fields reflect ONLY the
    // WYDOT-derived data, not some earlier test's stale row -- isolating
    // this test's real assertion: that a community report is display-only
    // and never touches those fields. wydotReportTime is set (fresh) too --
    // a missing one is now itself a staleness signal (LH T2 finding 3),
    // which isn't what this test is exercising.
    await insertStatusSnapshot({
      capturedAt: new Date().toISOString(),
      status: 'open',
      wydotReportTime: new Date().toISOString(),
    });

    // Stub the Resend fetcher so this POST doesn't attempt a real network
    // call (see notify.ts's setTestEmailFetcher / api-alerts.test.ts for the
    // full Resend-call assertions -- this test only cares about the
    // status.ts wiring).
    setTestEmailFetcher(async () => new Response('{}', { status: 200 }));
    let postRes: Response;
    try {
      postRes = await api.request(
        '/alerts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'closure', note: 'gate down', deviceId: 'status-wiring-device' }),
        },
        env as any,
      );
    } finally {
      setTestEmailFetcher(undefined);
    }
    expect(postRes.status).toBe(201);

    const { body } = await getStatus();
    expect(body.status).toBe('open');
    expect(body.pollerDead).toBe(false);
    expect(body.isStale).toBe(false);
    expect(body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'closure', note: 'gate down', direction: null }),
      ]),
    );
    // No hashes or internal fields ever leak into the public shape.
    expect(body.alerts.every((a) => !('deviceHash' in a) && !('ipHash' in a) && !('status' in a))).toBe(
      true,
    );
  });

  it('detours are populated only when the response status is closed', async () => {
    const now = Date.now();
    // An older, unrelated detour_snapshots cycle -- must not leak into the
    // response once a newer cycle exists.
    const staleCycleAt = new Date(now - 20 * 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO detour_snapshots (captured_at, route, condition_text) VALUES (?, 'US26', 'stale cycle, should not appear')`,
    )
      .bind(staleCycleAt)
      .run();

    const latestCycleAt = new Date(now).toISOString();
    await env.DB.prepare(
      `INSERT INTO detour_snapshots (captured_at, route, condition_text) VALUES (?, 'US26', 'Dry')`,
    )
      .bind(latestCycleAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO detour_snapshots (captured_at, route, condition_text) VALUES (?, 'US89', 'Falling Rock')`,
    )
      .bind(latestCycleAt)
      .run();

    await insertStatusSnapshot({ capturedAt: latestCycleAt, status: 'closed' });
    const { body } = await getStatus();
    expect(body.status).toBe('closed');
    expect(body.detours).toEqual(
      expect.arrayContaining([
        { route: 'US26', conditionText: 'Dry' },
        { route: 'US89', conditionText: 'Falling Rock' },
      ]),
    );
    expect(body.detours).toHaveLength(2);

    // Flip back to open: detours must be null, not just empty/stale.
    await insertStatusSnapshot({ capturedAt: new Date(now + 1000).toISOString(), status: 'open' });
    const { body: openBody } = await getStatus();
    expect(openBody.status).toBe('open');
    expect(openBody.detours).toBeNull();
  });

  it('detour rows more than 30 minutes older than the newest status snapshot are excluded, even though they are still the global MAX(captured_at) (a previous closure the poller never refreshed)', async () => {
    // Anchor well clear of real "now" so this test's detour row is
    // unambiguously the global MAX(captured_at) regardless of what earlier
    // tests in this file already inserted.
    const anchor = Date.now() + 10 * HOUR_MS;
    const staleDetourAt = new Date(anchor - 90 * 60_000).toISOString(); // 90 min before the closure below
    await env.DB.prepare(
      `INSERT INTO detour_snapshots (captured_at, route, condition_text) VALUES (?, 'US26', 'stale prior closure, should not appear')`,
    )
      .bind(staleDetourAt)
      .run();

    // The pass closes again later without the poller recording a fresh
    // detour cycle -- e.g. it briefly reopened and closed again.
    await insertStatusSnapshot({ capturedAt: new Date(anchor).toISOString(), status: 'closed' });
    const { body } = await getStatus();
    expect(body.status).toBe('closed');
    expect(body.detours).toEqual([]); // empty, not the stale rows, per existing "[] vs null" contract
  });

  it('id33Advisory reports the newest active event, preferring a full closure', async () => {
    await insertStatusSnapshot({ capturedAt: new Date().toISOString(), status: 'open' });

    await env.DB.prepare(
      `INSERT INTO id33_events (captured_at, event_id, description, is_full_closure, cleared_at)
       VALUES (?, 'evt-partial', 'Chain law in effect', 0, NULL)`,
    )
      .bind(new Date(Date.now() - 60_000).toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO id33_events (captured_at, event_id, description, is_full_closure, cleared_at)
       VALUES (?, 'evt-full', 'Full closure due to avalanche control', 1, NULL)`,
    )
      .bind(new Date().toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO id33_events (captured_at, event_id, description, is_full_closure, cleared_at)
       VALUES (?, 'evt-cleared', 'Old cleared event', 1, ?)`,
    )
      .bind(new Date(Date.now() - 120_000).toISOString(), new Date().toISOString())
      .run();

    const { body } = await getStatus();
    expect(body.id33Advisory).toBe('Full closure due to avalanche control');
  });

  it('id33Advisory (LH T2 finding 4): an active event whose captured_at is 25h old is ignored', async () => {
    await insertStatusSnapshot({ capturedAt: new Date().toISOString(), status: 'open' });

    await env.DB.prepare(
      `INSERT INTO id33_events (captured_at, event_id, description, is_full_closure, cleared_at)
       VALUES (?, 'evt-stale-active', 'Stale but never cleared', 1, NULL)`,
    )
      .bind(new Date(Date.now() - 25 * HOUR_MS).toISOString())
      .run();

    const { body } = await getStatus();
    // The stale event is a full closure, which would otherwise always win
    // over the still-active 'evt-full' from the previous test -- if it's
    // still winning here, the age filter isn't being applied.
    expect(body.id33Advisory).not.toBe('Stale but never cleared');
    expect(body.id33Advisory).toBe('Full closure due to avalanche control');
  });

  describe('weather (LH T2 finding 4 -- reportedAt survey/fix + weatherStale)', () => {
    async function insertWeatherSnapshot(overrides: {
      capturedAt: string;
      reportedAt?: string | null;
      airF?: number | null;
    }): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO weather_snapshots (captured_at, air_f, reported_at) VALUES (?, ?, ?)`,
      )
        .bind(overrides.capturedAt, overrides.airF ?? 20, overrides.reportedAt ?? null)
        .run();
    }

    it('weather.reportedAt reflects the parser\'s own WYDOT report time, not our capturedAt', async () => {
      const capturedAt = new Date().toISOString();
      const wydotReportedAt = new Date(Date.now() - 5 * 60_000).toISOString(); // WYDOT's page lagged our poll by 5min
      await insertWeatherSnapshot({ capturedAt, reportedAt: wydotReportedAt, airF: 31 });

      const { body } = await getStatus();
      expect(body.weather?.airF).toBe(31);
      expect(body.weather?.reportedAt).toBe(wydotReportedAt);
      expect(body.weather?.reportedAt).not.toBe(capturedAt);
    });

    it('weatherStale is false when the newest weather row is 59 minutes old', async () => {
      await insertWeatherSnapshot({
        capturedAt: new Date(Date.now() - 59 * 60_000).toISOString(),
        airF: 32,
      });

      const { body } = await getStatus();
      expect(body.weather?.airF).toBe(32);
      expect(body.weatherStale).toBe(false);
    });

    it('weatherStale is true when the newest weather row is 61 minutes old, but the reading is still returned', async () => {
      await insertWeatherSnapshot({
        capturedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
        airF: 33,
      });

      const { body } = await getStatus();
      expect(body.weather?.airF).toBe(33); // last-known still returned
      expect(body.weatherStale).toBe(true);
    });
  });
});
