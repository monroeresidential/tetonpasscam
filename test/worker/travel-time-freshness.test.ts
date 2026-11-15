// How long a drive-time reading counts as current, now that the poller no
// longer fetches every route every 10 minutes (see
// src/worker/poller/routes-schedule.ts). A reading is stale relative to when
// its replacement was due, so the window depends on the hour and direction
// the reading was captured in -- which is why every test here pins "now"
// rather than using the wall clock, and why this lives in its own file: the
// D1 instance is fresh per FILE, so readings pinned to July 2026 cannot
// collide with another suite's rows stamped at the real current time.
//
// Each test uses its own route, because /api/status reports only the LATEST
// reading per route.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { setTestNowMs } from '../../src/worker/api/status';
import { seedRoutes } from '../../src/worker/db/seed-routes';
import worker from '../../src/worker/index';
import type { ApiStatus } from '../../src/shared/types';

const MIN_MS = 60_000;
const DAY_MS = 24 * 3_600_000;

// July 2026 is MDT (UTC-6). 15th = Wednesday, 16th = Thursday, 18th = Saturday.
const mdt = (day: number, hour: number, minute = 0) => Date.UTC(2026, 6, day, hour + 6, minute);

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

async function insertReading(slug: string, capturedAtMs: number, durationSec: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`)
    .bind(await routeId(slug), new Date(capturedAtMs).toISOString(), durationSec)
    .run();
}

async function insertOpenSnapshot(capturedAtMs: number): Promise<void> {
  const iso = new Date(capturedAtMs).toISOString();
  await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', 'open', 'Road Open', '[]', '[]', ?, 'primary')`,
  )
    .bind(iso, iso)
    .run();
}

/** GET /api/status as it would answer at `nowMs`. */
async function travelTimeAt(nowMs: number, slug: string): Promise<ApiStatus['travelTimes'][number] | undefined> {
  setTestNowMs(nowMs);
  try {
    const res = await api.request('/status', {}, env as any);
    const body = (await res.json()) as ApiStatus;
    return body.travelTimes.find((t) => t.slug === slug);
  } finally {
    // MUST clear: a module-level override shared by every later test here.
    setTestNowMs(undefined);
  }
}

/** The homepage's injected crawler-facing status block, as served at `nowMs`. */
async function homepageBlockAt(nowMs: number, cacheCase: string): Promise<string> {
  setTestNowMs(nowMs);
  try {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`https://tetonpasscam.com/?case=${cacheCase}`), env as any, ctx);
    await waitOnExecutionContext(ctx);
    const match = (await res.text()).match(/<div data-live-status>.*?<\/div>/s);
    expect(match).not.toBeNull();
    return match![0];
  } finally {
    setTestNowMs(undefined);
  }
}

beforeAll(async () => {
  await seedRoutes(env.DB);
});

describe('GET /api/status — drive-time staleness follows the polling cadence', () => {
  it('a half-hourly midday reading is still current at 35 minutes, and keeps its comparison to typical', async () => {
    const slug = 'driggs-jackson-eb';
    const id = await routeId(slug);
    // Typical for (weekday, noon, summer), plus 14+ days of history so the
    // comparison is eligible to be shown at all.
    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, 'weekday', 12, 'summer', 2222, 2100, 2300)`,
    )
      .bind(id)
      .run();
    await insertReading(slug, mdt(15, 12, 0) - 20 * DAY_MS, 2500);
    await insertReading(slug, mdt(15, 12, 0), 2400);

    const entry = await travelTimeAt(mdt(15, 12, 35), slug);
    expect(entry).toBeTruthy();
    expect(entry!.stale).toBe(false);
    expect(entry!.typicalSec).toBe(2222);
  });

  it('a half-hourly reading goes stale once its replacement is more than 10 minutes overdue', async () => {
    const slug = 'driggs-tetonvillage-eb';
    await insertReading(slug, mdt(15, 12, 0), 2400);

    expect((await travelTimeAt(mdt(15, 12, 40), slug))!.stale).toBe(false);
    expect((await travelTimeAt(mdt(15, 12, 41), slug))!.stale).toBe(true);
  });

  it('at 8:31 AM a 31-minute-old Jackson-bound reading is stale but an equally old Idaho-bound one is not', async () => {
    // Jackson-bound is on its 10-minute rush cadence, so three cycles have
    // been missed. Idaho-bound is half-hourly, so its next reading was due
    // one minute ago.
    await insertReading('victor-tetonvillage-eb', mdt(15, 8, 0), 3000);
    await insertReading('victor-tetonvillage-wb', mdt(15, 8, 0), 2700);

    const now = mdt(15, 8, 31);
    expect((await travelTimeAt(now, 'victor-tetonvillage-eb'))!.stale).toBe(true);
    expect((await travelTimeAt(now, 'victor-tetonvillage-wb'))!.stale).toBe(false);
  });

  it('a rush-hour reading is still current at 29 minutes', async () => {
    const slug = 'driggs-airport-eb';
    await insertReading(slug, mdt(15, 8, 0), 3600);

    expect((await travelTimeAt(mdt(15, 8, 29), slug))!.stale).toBe(false);
  });

  it('an hourly evening reading is current for 70 minutes, then stale', async () => {
    const slug = 'victor-airport-wb';
    await insertReading(slug, mdt(18, 20, 0), 2000);

    expect((await travelTimeAt(mdt(18, 21, 5), slug))!.stale).toBe(false);
    expect((await travelTimeAt(mdt(18, 21, 11), slug))!.stale).toBe(true);
  });
});

describe('GET / — the injected status block uses the same staleness rule', () => {
  it('quotes a half-hourly Victor-to-Jackson reading at 35 minutes and drops it at 41', async () => {
    // Thursday, so this route's reading cannot be confused with the
    // Wednesday rows the /api/status tests above insert for other routes.
    await insertReading('victor-jackson-eb', mdt(16, 12, 0), 41 * 60);

    await insertOpenSnapshot(mdt(16, 12, 35));
    const current = await homepageBlockAt(mdt(16, 12, 35), 'reading-35-min-old');
    expect(current).toContain('Teton Pass is open');
    expect(current).toContain('about 41 minutes');

    await insertOpenSnapshot(mdt(16, 12, 41));
    const stale = await homepageBlockAt(mdt(16, 12, 41), 'reading-41-min-old');
    expect(stale).toContain('Teton Pass is open');
    expect(stale).not.toContain('Victor to Jackson');
  });
});
