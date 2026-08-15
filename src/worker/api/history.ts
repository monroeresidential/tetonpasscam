import { eq } from 'drizzle-orm';

import { db, routes, routeTypicals } from '../db';
import type { Env } from '../env';
import { nearestRank } from '../poller/aggregate';
import { denverDateKey, denverMidnightMs, denverParts, denverSeasonStartMs } from '../tz';
import type { HistoryResult, HistorySummary, HistoryTypical } from '../../shared/types';

// Re-exported so existing importers (test/worker/api-history.test.ts,
// api/router.ts) keep resolving these from here after the move to shared/.
export type { HistoryResult, HistorySummary, HistoryTypical } from '../../shared/types';

interface TodayRow {
  capturedAt: string;
  durationSec: number;
}

/**
 * Per-Denver-day peak travel time for the current season to date, worst 3
 * first. Grouped in TS rather than SQL for the same reason rebuildTypicals
 * does it: SQLite/D1 has no time-zone functions, so a SQL GROUP BY would
 * group by UTC day and split Denver evenings across two rows.
 *
 * Returns null (not []) when the season has no readings -- the UI renders
 * an empty state for "we have not recorded any of this season yet", which
 * is a different statement from "this season had no slow days".
 */
async function worstDaysThisSeason(
  env: Env,
  routeId: number,
  nowMs: number,
): Promise<{ date: string; peakSec: number }[] | null> {
  const seasonStartIso = new Date(denverSeasonStartMs(nowMs)).toISOString();
  const rows = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, duration_sec AS durationSec
         FROM travel_times WHERE route_id = ? AND captured_at >= ?`,
    )
      .bind(routeId, seasonStartIso)
      .all()
  ).results as unknown as TodayRow[];

  const peaks = new Map<string, number>();
  for (const row of rows) {
    const ms = Date.parse(row.capturedAt);
    if (!Number.isFinite(ms)) continue; // same defensive skip as aggregate.ts
    const key = denverDateKey(ms);
    const prev = peaks.get(key);
    if (prev === undefined || row.durationSec > prev) peaks.set(key, row.durationSec);
  }
  if (peaks.size === 0) return null;

  return [...peaks.entries()]
    .map(([date, peakSec]) => ({ date, peakSec }))
    .sort((a, b) => b.peakSec - a.peakSec)
    .slice(0, 3);
}

/** Median across every hour bucket recorded for `season`, or null if none. */
function seasonMedian(typicals: HistoryTypical[], season: 'winter' | 'summer'): number | null {
  const medians = typicals
    .filter((t) => t.season === season && t.medianSec !== null)
    .map((t) => t.medianSec as number)
    .sort((a, b) => a - b);
  return medians.length === 0 ? null : nearestRank(medians, 50);
}

/**
 * Distinct Denver days with a CLOSED status during the most recent
 * COMPLETED winter (Nov 1 - Apr 30). Returns null when our snapshot history
 * does not reach back to the start of that winter: we cannot distinguish
 * "no closures" from "we were not watching", and reporting 0 would assert
 * the former. The mock's "Closure days last winter: 11" is sample data --
 * this field stays null until we have actually observed a full winter.
 */
async function closureDaysLastWinter(env: Env, nowMs: number): Promise<number | null> {
  const { season } = denverParts(nowMs);
  const currentSeasonStart = denverSeasonStartMs(nowMs);
  // If it is currently winter, "last completed winter" is the one before
  // this one; otherwise it is the winter that ended this spring.
  const probeMs =
    season === 'winter'
      ? currentSeasonStart - 24 * 3_600_000 * 200 // land in the prior winter
      : currentSeasonStart - 24 * 3_600_000; // April 30, the winter just ended
  const winterStart = denverSeasonStartMs(probeMs);
  const winterEnd = denverSeasonStartMs(winterStart + 24 * 3_600_000 * 200); // the following May 1

  const earliest = (await env.DB.prepare(
    'SELECT MIN(captured_at) AS earliest FROM status_snapshots',
  ).first()) as { earliest: string | null } | null;
  if (!earliest?.earliest) return null;
  if (Date.parse(earliest.earliest) > winterStart) return null; // no coverage

  const rows = (
    await env.DB.prepare(
      // Lowercase 'closed' -- schema.ts:66 declares the enum as
      // ['open','restricted','closed','unknown']. The four-state names are
      // uppercase in the API/UI layer but lowercase in the DB column.
      `SELECT captured_at AS capturedAt FROM status_snapshots
        WHERE status = 'closed' AND captured_at >= ? AND captured_at < ?`,
    )
      .bind(new Date(winterStart).toISOString(), new Date(winterEnd).toISOString())
      .all()
  ).results as unknown as { capturedAt: string }[];

  const days = new Set<string>();
  for (const row of rows) {
    const ms = Date.parse(row.capturedAt);
    if (Number.isFinite(ms)) days.add(denverDateKey(ms));
  }
  return days.size;
}

/**
 * Assembles `GET /api/history?route=<slug>`. Returns `null` for an unknown
 * slug -- the caller (router.ts) turns that into a 404.
 *
 * `today` = every `travel_times` row for this route captured since
 * Denver-local midnight (per `nowMs`, defaulting to real time), ascending by
 * `captured_at`.
 *
 * `includeSummary` gates `worstDaysThisSeason` and `closureDaysLastWinter`,
 * the two expensive queries here: `worstDaysThisSeason` scans every
 * `travel_times` row since the season start (tens of thousands of rows per
 * route by late season). The home page's compact chart card only needs
 * `typicals`/`today` and never sets this; only the /history page's summary
 * tables opt in. Defaults to `false` so the cheap path is the default for
 * any caller that doesn't say otherwise.
 */
export async function getHistory(
  env: Env,
  slug: string,
  nowMs: number = Date.now(),
  includeSummary: boolean = false,
): Promise<HistoryResult | null> {
  const database = db(env);

  const [route] = await database.select().from(routes).where(eq(routes.slug, slug)).limit(1);
  if (!route) return null;

  const typicalRows = await database
    .select()
    .from(routeTypicals)
    .where(eq(routeTypicals.routeId, route.id));

  const typicals: HistoryTypical[] = typicalRows.map((r) => ({
    weekdayClass: r.weekdayClass,
    season: r.season,
    hour: r.hour,
    medianSec: r.medianSec,
    p25Sec: r.p25Sec,
    p75Sec: r.p75Sec,
    sampleCount: r.sampleCount,
    distinctDays: r.distinctDays,
  }));

  const todayStartIso = new Date(denverMidnightMs(nowMs)).toISOString();
  const todayRows = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, duration_sec AS durationSec
         FROM travel_times
        WHERE route_id = ? AND captured_at >= ?
        ORDER BY captured_at ASC`,
    )
      .bind(route.id, todayStartIso)
      .all()
  ).results as unknown as TodayRow[];

  const summary: HistorySummary | null = includeSummary
    ? {
        worstDays: await worstDaysThisSeason(env, route.id, nowMs),
        seasonMedians: {
          summer: seasonMedian(typicals, 'summer'),
          winter: seasonMedian(typicals, 'winter'),
        },
        closureDays: { winter: await closureDaysLastWinter(env, nowMs) },
      }
    : null;

  return { route: { slug: route.slug, name: route.name }, typicals, today: todayRows, summary };
}
