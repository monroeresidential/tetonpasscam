import { desc, isNull, ne } from 'drizzle-orm';

import type { ApiStatus, PublicAlert } from '../../shared/types';
import type { PassStatus } from '../../shared/types';
import { db, id33Events, statusSnapshots, weatherSnapshots } from '../db';
import type { Env } from '../env';

/** Newest snapshot older than this ⇒ the poller itself is considered dead;
 *  the response's `status` is forced to 'unknown' regardless of what that
 *  stale snapshot's own `status` column says. */
export const DEAD_HOURS = 2;
/** WYDOT's own report timestamp (not our capture time) older than this ⇒
 *  `isStale` true. Independent of `pollerDead`/`status`: staleness surfaces
 *  alongside the status, it never hides or overrides it. */
export const STALE_HOURS = 12;
/** A route's travel-time history must span at least this many days before
 *  its `route_typicals` lookup is trusted enough to surface as `typicalSec`. */
export const MIN_HISTORY_DAYS = 14;

/**
 * Test-only clock override for `GET /status`'s "now". There is no
 * request-triggerable way to reach this (no query param, no header) --
 * it's a plain module-level slot only reachable by importing this module
 * directly, which only test code ever does, so it's un-abusable from an
 * actual HTTP request in production. Tests pin an exact instant (e.g. to
 * exercise the America/Denver weekday/season derivation at a UTC-day
 * boundary) via `setTestNowMs()`, then MUST clear it again (`setTestNowMs
 * (undefined)`) so it doesn't leak into later tests in the same file/worker
 * instance.
 */
let testNowMsOverride: number | undefined;

/** Test-only: see `testNowMsOverride`. */
export function setTestNowMs(ms: number | undefined): void {
  testNowMsOverride = ms;
}

function effectiveNowMs(): number {
  return testNowMsOverride ?? Date.now();
}

/** Parse a JSON-array-of-strings column (status_snapshots.advisories /
 *  .restrictions) defensively: malformed/absent JSON, or JSON that isn't an
 *  array of strings, resolves to `[]` rather than throwing. */
function safeStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const DENVER_PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  hourCycle: 'h23',
  weekday: 'short',
  month: 'numeric',
});

/**
 * Derive the (weekday-class, hour, season) key used to look up a route's
 * typical travel time for "now", all computed in America/Denver per the
 * brief (there's DST-aware Denver-tz precedent in google-routes.ts /
 * wydot-status.ts; this is a small local helper rather than reaching for a
 * shared tz module, which is Task 12's job).
 */
export function denverTypicalsKey(nowMs: number): {
  weekdayClass: 'weekday' | 'weekend';
  hour: number;
  season: 'winter' | 'summer';
} {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = Number(get('hour'));
  const month = Number(get('month'));
  return {
    weekdayClass: weekday === 'Sat' || weekday === 'Sun' ? 'weekend' : 'weekday',
    hour,
    season: month >= 11 || month <= 4 ? 'winter' : 'summer',
  };
}

interface TravelTimeRow {
  slug: string;
  name: string;
  durationSec: number;
  capturedAt: string;
  routeId: number;
}

interface MinCapturedRow {
  routeId: number;
  minCapturedAt: string;
}

interface TypicalRow {
  routeId: number;
  medianSec: number | null;
}

interface DetourRow {
  route: string | null;
  conditionText: string | null;
}

/**
 * Assemble the GET /api/status response. Reads Date.now() at call time by
 * default (overridable per-call via `nowMs`; most tests instead seed
 * capturedAt/wydotReportTime values relative to whatever "now" resolves to
 * when the handler actually runs -- no fake timers needed since
 * vitest-pool-workers runs in a real Workers runtime). The one exception is
 * `effectiveNowMs()`'s test-only override (`setTestNowMs`), used when a test
 * needs to pin an exact instant rather than "whenever this test happens to
 * run" -- e.g. to exercise a specific UTC-vs-Denver day/hour boundary.
 */
export async function getStatus(env: Env, nowMs: number = effectiveNowMs()): Promise<ApiStatus> {
  const database = db(env);

  const [newest] = await database
    .select()
    .from(statusSnapshots)
    .orderBy(desc(statusSnapshots.id))
    .limit(1);

  const [lastConfirmedRow] = await database
    .select()
    .from(statusSnapshots)
    .where(ne(statusSnapshots.status, 'unknown'))
    .orderBy(desc(statusSnapshots.id))
    .limit(1);

  const lastConfirmed = lastConfirmedRow
    ? {
        status: lastConfirmedRow.status as Exclude<PassStatus, 'unknown'>,
        at: lastConfirmedRow.capturedAt,
      }
    : null;

  let status: PassStatus = 'unknown';
  let pollerDead = true;
  let isStale = false;
  let conditionText: string | null = null;
  let advisories: string[] = [];
  let restrictions: string[] = [];
  let wydotReportTime: string | null = null;

  if (newest) {
    const snapshotAgeMs = nowMs - Date.parse(newest.capturedAt);
    pollerDead = !Number.isFinite(snapshotAgeMs) || snapshotAgeMs > DEAD_HOURS * 3_600_000;
    status = pollerDead ? 'unknown' : (newest.status as PassStatus);
    conditionText = newest.conditionText;
    advisories = safeStringArray(newest.advisories);
    restrictions = safeStringArray(newest.restrictions);
    wydotReportTime = newest.wydotReportTime;
    if (wydotReportTime) {
      const reportAgeMs = nowMs - Date.parse(wydotReportTime);
      isStale = Number.isFinite(reportAgeMs) && reportAgeMs > STALE_HOURS * 3_600_000;
    }
  }

  const [weatherRow] = await database
    .select()
    .from(weatherSnapshots)
    .orderBy(desc(weatherSnapshots.id))
    .limit(1);
  const weather = weatherRow
    ? {
        airF: weatherRow.airF,
        surfaceF: weatherRow.surfaceF,
        windAvgMph: weatherRow.windAvg,
        windGustMph: weatherRow.windGust,
        windDir: weatherRow.windDir,
        visibilityFt: weatherRow.visibilityFt,
        reportedAt: weatherRow.capturedAt,
      }
    : null;

  // Travel times: latest travel_times row per route, joined to routes for
  // slug/name. Raw SQL (rather than drizzle's query builder) for the
  // GROUP BY + self-join the brief calls for; the D1 binding used directly
  // is the same binding drizzle wraps.
  const { weekdayClass, hour, season } = denverTypicalsKey(nowMs);

  const latestTravelRows = (
    await env.DB.prepare(
      `SELECT r.slug AS slug, r.name AS name, t.duration_sec AS durationSec,
              t.captured_at AS capturedAt, t.route_id AS routeId
         FROM travel_times t
         INNER JOIN (
           SELECT route_id, MAX(captured_at) AS max_captured_at
             FROM travel_times
            GROUP BY route_id
         ) latest ON latest.route_id = t.route_id AND latest.max_captured_at = t.captured_at
         INNER JOIN routes r ON r.id = t.route_id`,
    ).all()
  ).results as unknown as TravelTimeRow[];

  const minCapturedRows = (
    await env.DB.prepare(
      `SELECT route_id AS routeId, MIN(captured_at) AS minCapturedAt FROM travel_times GROUP BY route_id`,
    ).all()
  ).results as unknown as MinCapturedRow[];
  const minCapturedByRoute = new Map(minCapturedRows.map((r) => [r.routeId, r.minCapturedAt]));

  const typicalRows = (
    await env.DB.prepare(
      `SELECT route_id AS routeId, median_sec AS medianSec
         FROM route_typicals
        WHERE weekday_class = ? AND hour = ? AND season = ?`,
    )
      .bind(weekdayClass, hour, season)
      .all()
  ).results as unknown as TypicalRow[];
  const typicalByRoute = new Map(typicalRows.map((r) => [r.routeId, r.medianSec]));

  const minHistoryMs = MIN_HISTORY_DAYS * 24 * 3_600_000;
  const travelTimes = latestTravelRows.map((row) => {
    const minCapturedAt = minCapturedByRoute.get(row.routeId);
    const historyEligible =
      minCapturedAt !== undefined && nowMs - Date.parse(minCapturedAt) >= minHistoryMs;
    return {
      slug: row.slug,
      name: row.name,
      durationSec: row.durationSec,
      typicalSec: historyEligible ? (typicalByRoute.get(row.routeId) ?? null) : null,
      capturedAt: row.capturedAt,
    };
  });

  // Idaho 511 ID-33 advisory: newest active event, preferring a full closure
  // over a lesser advisory when more than one is active at once.
  const activeId33Events = await database
    .select()
    .from(id33Events)
    .where(isNull(id33Events.clearedAt))
    .orderBy(desc(id33Events.id));
  let id33Advisory: string | null = null;
  if (activeId33Events.length > 0) {
    const fullClosure = activeId33Events.find((e) => e.isFullClosure);
    id33Advisory = (fullClosure ?? activeId33Events[0]).description ?? null;
  }

  // Detours only accompany a 'closed' response status, and only the most
  // recent poll cycle's detour rows (not every closure ever recorded).
  let detours: { route: string; conditionText: string }[] | null = null;
  if (status === 'closed') {
    const detourRows = (
      await env.DB.prepare(
        `SELECT route, condition_text AS conditionText
           FROM detour_snapshots
          WHERE captured_at = (SELECT MAX(captured_at) FROM detour_snapshots)`,
      ).all()
    ).results as unknown as DetourRow[];
    detours = detourRows
      .filter((r): r is { route: string; conditionText: string } => r.route !== null && r.conditionText !== null)
      .map((r) => ({ route: r.route, conditionText: r.conditionText }));
  }

  const alerts: PublicAlert[] = []; // wired in Task 10

  return {
    status,
    isStale,
    pollerDead,
    lastConfirmed,
    conditionText,
    advisories,
    restrictions,
    wydotReportTime,
    weather,
    travelTimes,
    id33Advisory,
    detours,
    alerts,
  };
}
