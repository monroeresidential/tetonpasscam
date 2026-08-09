import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { denverTypicalsKey } from '../../src/worker/api/status';
import { seedRoutes } from '../../src/worker/db/seed-routes';
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

  it('alerts is always [] (Task 10 wires this up)', async () => {
    const { body } = await getStatus();
    expect(body.alerts).toEqual([]);
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
});
