// DB-loading layer of the /og share-card renderer (src/worker/card/data.ts)
// -- direction/non-airport route filtering, the ±5min travel-time window,
// per-route closest-reading selection, and the wydotReportTime/capturedAt
// "as of" preference. No WASM/rendering involved, so this hits the real D1
// binding directly (same vitest-pool-workers env as api-status.test.ts).
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadCardData, resolveShareCode } from '../../src/worker/card/data';
import { seedRoutes } from '../../src/worker/db/seed-routes';
import { formatShareCode } from '../../src/worker/share-code';

const MINUTE_MS = 60_000;

async function routeId(slug: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT id FROM routes WHERE slug = ?').bind(slug).first()) as {
    id: number;
  };
  return row.id;
}

async function insertSnapshot(overrides: {
  capturedAt: string;
  status: 'open' | 'restricted' | 'closed' | 'unknown';
  restrictions?: string[];
  wydotReportTime?: string | null;
}): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO status_snapshots
       (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
     VALUES (?, 'wilson-stateline', ?, NULL, '[]', ?, ?, 'primary')
     RETURNING id`,
  )
    .bind(
      overrides.capturedAt,
      overrides.status,
      JSON.stringify(overrides.restrictions ?? []),
      overrides.wydotReportTime === undefined ? overrides.capturedAt : overrides.wydotReportTime,
    )
    .first<{ id: number }>();
  return result!.id;
}

async function insertTravelTime(slug: string, capturedAt: string, durationSec: number): Promise<void> {
  const id = await routeId(slug);
  await env.DB.prepare(
    `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`,
  )
    .bind(id, capturedAt, durationSec)
    .run();
}

describe('loadCardData', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('returns null for an id with no matching snapshot', async () => {
    const result = await loadCardData(env as any, 999_999_999, 'eb');
    expect(result).toBeNull();
  });

  it('loads status + restrictions and resolves asOfIso to wydotReportTime when present', async () => {
    const capturedAt = new Date('2026-08-10T12:00:00.000Z').toISOString();
    const reportTime = new Date('2026-08-10T11:45:00.000Z').toISOString();
    const id = await insertSnapshot({
      capturedAt,
      status: 'restricted',
      restrictions: ['chains required'],
      wydotReportTime: reportTime,
    });

    const result = await loadCardData(env as any, id, 'eb');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('restricted');
    expect(result!.restrictions).toEqual(['chains required']);
    expect(result!.asOfIso).toBe(reportTime);
  });

  it('falls back to capturedAt for asOfIso when wydotReportTime is null', async () => {
    const capturedAt = new Date('2026-08-10T13:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open', wydotReportTime: null });

    const result = await loadCardData(env as any, id, 'eb');
    expect(result!.asOfIso).toBe(capturedAt);
  });

  it('includes only non-airport routes in the requested direction, within ±5min of capturedAt', async () => {
    const capturedAt = new Date('2026-08-10T14:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    // In-window, requested direction, non-airport -- included.
    await insertTravelTime('victor-jackson-eb', new Date(Date.parse(capturedAt) + 2 * MINUTE_MS).toISOString(), 38 * 60);
    await insertTravelTime('driggs-jackson-eb', new Date(Date.parse(capturedAt) - 3 * MINUTE_MS).toISOString(), 46 * 60);
    // Wrong direction -- excluded.
    await insertTravelTime('victor-jackson-wb', capturedAt, 40 * 60);
    // Airport route, otherwise in-window and right direction -- excluded
    // (design doc: "4 non-airport routes").
    await insertTravelTime('victor-airport-eb', capturedAt, 20 * 60);
    // Outside the ±5min window -- excluded.
    await insertTravelTime('victor-tetonvillage-eb', new Date(Date.parse(capturedAt) + 30 * MINUTE_MS).toISOString(), 50 * 60);

    const result = await loadCardData(env as any, id, 'eb');
    const names = result!.routes.map((r) => r.name).sort();
    expect(names).toEqual(['Driggs → Jackson', 'Victor → Jackson'].sort());
    const victor = result!.routes.find((r) => r.name === 'Victor → Jackson');
    expect(victor!.durationSec).toBe(38 * 60);
  });

  it('when a route has multiple readings inside the window, keeps only the one closest to capturedAt', async () => {
    const capturedAt = new Date('2026-08-10T15:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    await insertTravelTime('victor-jackson-eb', new Date(Date.parse(capturedAt) - 4 * MINUTE_MS).toISOString(), 99 * 60);
    await insertTravelTime('victor-jackson-eb', new Date(Date.parse(capturedAt) + 1 * MINUTE_MS).toISOString(), 41 * 60);

    const result = await loadCardData(env as any, id, 'eb');
    const victor = result!.routes.find((r) => r.name === 'Victor → Jackson');
    expect(victor!.durationSec).toBe(41 * 60);
  });

  it('zero travel-time rows in the window ⇒ empty routes array, not an error', async () => {
    const capturedAt = new Date('2026-08-10T16:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });

    const result = await loadCardData(env as any, id, 'eb');
    expect(result!.routes).toEqual([]);
  });
});

describe('resolveShareCode', () => {
  beforeAll(async () => {
    await seedRoutes(env.DB);
  });

  it('returns null for a malformed code', async () => {
    expect(await resolveShareCode(env as any, '53')).toBeNull();
    expect(await resolveShareCode(env as any, 'not-a-code')).toBeNull();
  });

  it('returns null for a well-formed code with no matching snapshot', async () => {
    expect(await resolveShareCode(env as any, '20990101-0000')).toBeNull();
  });

  it('resolves a normal (non-DST-boundary) day via the constant-offset window guess', async () => {
    const capturedAt = new Date('2026-08-10T20:00:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });
    const code = formatShareCode(capturedAt);

    expect(await resolveShareCode(env as any, code)).toBe(id);
  });

  it('resolves a snapshot just after the spring-forward DST jump, where the window guess drifts 1h', async () => {
    const capturedAt = new Date('2026-03-08T09:30:00.000Z').toISOString();
    const id = await insertSnapshot({ capturedAt, status: 'open' });
    const code = formatShareCode(capturedAt);
    expect(code).toBe('20260308-0330');

    expect(await resolveShareCode(env as any, code)).toBe(id);
  });

  it('fall-back night: two distinct real snapshots an hour apart share the same code (the repeated 1am hour) -- the NEWER one must win, not whichever the window guess happens to land on', async () => {
    // 2026-11-01 02:00 America/Denver falls back to 01:00: 01:30 MDT
    // (2026-11-01T07:30:00Z) and 01:30 MST (2026-11-01T08:30:00Z, an hour
    // later in real time) both format to "20261101-0130". The window guess
    // (shareCodeToUtcWindow) always lands on the FIRST (older, MDT)
    // occurrence -- a short-circuit on that alone would silently return the
    // older snapshot here, which is the exact bug this test pins.
    const olderCapturedAt = new Date('2026-11-01T07:30:00.000Z').toISOString();
    const newerCapturedAt = new Date('2026-11-01T08:30:00.000Z').toISOString();
    const olderCode = formatShareCode(olderCapturedAt);
    const newerCode = formatShareCode(newerCapturedAt);
    expect(olderCode).toBe('20261101-0130');
    expect(newerCode).toBe(olderCode);

    await insertSnapshot({ capturedAt: olderCapturedAt, status: 'open' });
    const newerId = await insertSnapshot({ capturedAt: newerCapturedAt, status: 'closed' });

    expect(await resolveShareCode(env as any, olderCode)).toBe(newerId);
  });

  it('multiple snapshots naming the same minute resolve to the newest (highest id)', async () => {
    const capturedAt1 = new Date('2026-08-10T21:00:00.000Z').toISOString();
    const capturedAt2 = new Date('2026-08-10T21:00:30.000Z').toISOString();
    await insertSnapshot({ capturedAt: capturedAt1, status: 'open' });
    const newerId = await insertSnapshot({ capturedAt: capturedAt2, status: 'closed' });
    const code = formatShareCode(capturedAt1);
    expect(formatShareCode(capturedAt2)).toBe(code);

    expect(await resolveShareCode(env as any, code)).toBe(newerId);
  });
});
