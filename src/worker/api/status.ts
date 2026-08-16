import { desc, isNull, ne } from 'drizzle-orm';

import type { ApiStatus, ForecastDay } from '../../shared/types';
import type { PassStatus } from '../../shared/types';
import { db, id33Events, statusSnapshots, weatherSnapshots } from '../db';
import type { Env } from '../env';
import { formatShareCode } from '../share-code';
import { denverDateKey, denverParts } from '../tz';
import { getActiveAlerts } from './alerts';
import { toIconPath } from './wx-icon';

/** Newest snapshot older than this ⇒ the poller itself is considered dead;
 *  the response's `status` is forced to 'unknown' regardless of what that
 *  stale snapshot's own `status` column says. */
export const DEAD_HOURS = 2;
/** WYDOT's own report timestamp (not our capture time) older than this ⇒
 *  `isStale` true. Independent of `pollerDead`/`status`: staleness surfaces
 *  alongside the status, it never hides or overrides it. */
export const STALE_HOURS = 12;
/** Small clock-skew tolerance for `wydotReportTime` reading slightly ahead of
 *  our own clock (NTP drift, request latency). Anything further ahead than
 *  this is implausible for a same-minute report and is treated as
 *  untrustworthy -- i.e. stale -- rather than "fresher than expected". */
export const FUTURE_SKEW_TOLERANCE_MIN = 15;
/** A travel_times row older than this is flagged `stale` in the response
 *  (see `TRAVEL_TIME_MAX_AGE_HOURS` below for when it's dropped instead) --
 *  a 45-minute-old drive time displayed as if it were live would mislead a
 *  driver deciding whether to leave now, so past this point it's shown
 *  muted/labeled rather than as current. */
export const TRAVEL_TIME_FRESHNESS_MIN = 30;
/** A travel_times row older than this is dropped from the response entirely,
 *  same as `TRAVEL_TIME_FRESHNESS_MIN` above -- but rows between the two
 *  cutoffs are still returned, flagged `stale: true`, so the overnight
 *  polling gap (Google Routes only runs 05:00-23:00 America/Denver, max
 *  ~6.5h between the last evening poll and the next morning one) shows the
 *  last evening reading instead of "no data" without ever resurfacing a
 *  multi-day-old reading after a poller outage. */
export const TRAVEL_TIME_MAX_AGE_HOURS = 12;
/** Newest weather_snapshots row older than this ⇒ `weatherStale` true. The
 *  reading itself is still returned (last-known beats nothing for a stat
 *  strip), but the frontend must flag it as not current. */
export const WEATHER_STALE_MIN = 60;
/** An Idaho 511 ID-33 event whose own `captured_at` is older than this is
 *  ignored entirely when picking `id33Advisory` -- a stale event we simply
 *  never got a fresher read on (fetch outage, cleared-without-notice) must
 *  not go on surfacing as if it were still active. */
export const ID33_MAX_AGE_HOURS = 24;
/** A route's travel-time history must span at least this many days before
 *  its `route_typicals` lookup is trusted enough to surface as `typicalSec`. */
export const MIN_HISTORY_DAYS = 14;
/** A detour row is only included if its `captured_at` is within this many
 *  minutes of the newest status snapshot's `captured_at` -- without this
 *  bound, a global `MAX(captured_at)` over `detour_snapshots` would keep
 *  surfacing a previous closure's detour rows as current if the pass later
 *  reopens and then closes again before the poller records a fresh detour
 *  cycle (e.g. a poller hiccup on the second closure). */
export const DETOUR_FRESHNESS_MIN = 30;
/** Newest forecast_days row older than this ⇒ `forecastStale` true. Six
 *  hours rather than the one-hour refresh interval: NWS itself only
 *  regenerates hourly, so a two-hour-old forecast is still a current
 *  forecast, and flagging it would cry wolf. */
export const FORECAST_STALE_HOURS = 6;
/** Cards the home strip renders. */
export const FORECAST_DAYS = 5;

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

export function effectiveNowMs(): number {
  return testNowMsOverride ?? Date.now();
}

/** True when `wydotReportTime` cannot be trusted as a fresh reading:
 *  missing, unparseable, more than `STALE_HOURS` in the past, or more than
 *  `FUTURE_SKEW_TOLERANCE_MIN` minutes in the future. Only meaningful for a
 *  snapshot whose own `status` isn't already 'unknown' -- callers gate on
 *  that separately (an 'unknown' snapshot has nothing to be "stale" about;
 *  see `getStatus`). */
function isReportTimeStale(wydotReportTime: string | null, nowMs: number): boolean {
  if (!wydotReportTime) return true;
  const reportMs = Date.parse(wydotReportTime);
  if (!Number.isFinite(reportMs)) return true;
  const ageMs = nowMs - reportMs;
  if (ageMs > STALE_HOURS * 3_600_000) return true;
  if (ageMs < -FUTURE_SKEW_TOLERANCE_MIN * 60_000) return true;
  return false;
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

/**
 * Derive the (weekday-class, hour, season) key used to look up a route's
 * typical travel time for "now", all computed in America/Denver per the
 * brief. Thin wrapper over the shared `tz.ts` derivation (Task 12
 * consolidated this and google-routes.ts's `inPollingWindow` onto one
 * module) -- kept exported here under its original name since
 * test/worker/api-status.test.ts imports it from this module.
 */
export function denverTypicalsKey(nowMs: number): {
  weekdayClass: 'weekday' | 'weekend';
  hour: number;
  season: 'winter' | 'summer';
} {
  return denverParts(nowMs);
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
  let surfaceCondition: string | null = null;
  let advisories: string[] = [];
  let restrictions: string[] = [];
  let wydotReportTime: string | null = null;

  if (newest) {
    const snapshotAgeMs = nowMs - Date.parse(newest.capturedAt);
    pollerDead = !Number.isFinite(snapshotAgeMs) || snapshotAgeMs > DEAD_HOURS * 3_600_000;
    status = pollerDead ? 'unknown' : (newest.status as PassStatus);
    conditionText = newest.conditionText;
    // Withheld once the poller is dead, for the same reason `status` degrades
    // to unknown there: a road-surface description is an observation with a
    // shelf life. Rendering a three-day-old "Dry" next to an UNKNOWN banner
    // would read as a current report of a dry road -- the precise kind of
    // stale-data-presented-as-fresh this app's rules forbid.
    surfaceCondition = pollerDead ? null : newest.surfaceConditionText;
    advisories = safeStringArray(newest.advisories);
    restrictions = safeStringArray(newest.restrictions);
    wydotReportTime = newest.wydotReportTime;
    // Staleness is about trusting THIS snapshot's own report time -- an
    // already-'unknown' snapshot (both sources failed, or an unresolved
    // disagreement) has no report to be stale about, so it's left at the
    // default `false` rather than flagged stale on top of already being
    // unknown. A non-'unknown' snapshot with a missing/unparseable/
    // implausible report time (e.g. every 'crosscheck'-sourced row, which
    // never carries a wydotReportTime at all) DOES get flagged -- that's
    // exactly the gap this rule closes: a crosscheck-derived 'closed'/
    // 'restricted' status is real, but its currency can't be verified the
    // normal way, so it must present as stale rather than silently fresh.
    if (newest.status !== 'unknown') {
      isStale = isReportTimeStale(wydotReportTime, nowMs);
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
        humidityPct: weatherRow.humidityPct,
        dewPointF: weatherRow.dewPointF,
        // WYDOT's own report timestamp (weather_snapshots.reported_at),
        // NOT weatherRow.capturedAt (our fetch time) -- see LH T2 finding
        // 4's survey: pre-fix, this column didn't exist and capturedAt got
        // relabeled as reportedAt here, so a driver reading "as of" was
        // really seeing "when we last polled", not WYDOT's own reading
        // time. Still nullable: the parser can fail to find/parse the
        // timestamp text even when the numeric readings come through.
        reportedAt: weatherRow.reportedAt,
      }
    : null;
  // Independent of the reportedAt fix above: whether the reading itself is
  // recent enough to present as current, based on OUR OWN capture time
  // (same freshness-window pattern as travelTimes/id33Advisory below), not
  // WYDOT's report time -- a poller outage should flag stale weather even
  // if WYDOT's own timestamp on the last-fetched row still looks recent.
  const weatherStale = weatherRow
    ? (() => {
        const ageMs = nowMs - Date.parse(weatherRow.capturedAt);
        return !Number.isFinite(ageMs) || ageMs > WEATHER_STALE_MIN * 60_000;
      })()
    : false;

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
  const travelTimeFreshnessMs = TRAVEL_TIME_FRESHNESS_MIN * 60_000;
  const travelTimeMaxAgeMs = TRAVEL_TIME_MAX_AGE_HOURS * 3_600_000;
  const travelTimes = latestTravelRows
    // A route's latest row can still be older than the max-age cap (the
    // poller failed for that route across the whole overnight gap, or
    // longer) -- omit it entirely, same "no valid placeholder" contract as a
    // route with zero history at all. Rows within the cap but past the
    // freshness window are kept and flagged `stale` below instead.
    .filter((row) => {
      const ageMs = nowMs - Date.parse(row.capturedAt);
      return Number.isFinite(ageMs) && ageMs <= travelTimeMaxAgeMs;
    })
    .map((row) => {
      const ageMs = nowMs - Date.parse(row.capturedAt);
      const stale = ageMs > travelTimeFreshnessMs;
      const minCapturedAt = minCapturedByRoute.get(row.routeId);
      const historyEligible =
        minCapturedAt !== undefined && nowMs - Date.parse(minCapturedAt) >= minHistoryMs;
      return {
        slug: row.slug,
        name: row.name,
        durationSec: row.durationSec,
        // A stale reading (e.g. last night's 10:50 PM drive time) compared
        // against the CURRENT hour's typical would produce a meaningless
        // delta, so typicalSec is forced null whenever stale regardless of
        // history eligibility.
        typicalSec: stale || !historyEligible ? null : (typicalByRoute.get(row.routeId) ?? null),
        capturedAt: row.capturedAt,
        stale,
      };
    });

  // Idaho 511 ID-33 advisory: newest active event, preferring a full closure
  // over a lesser advisory when more than one is active at once. Events
  // whose own captured_at is older than ID33_MAX_AGE_HOURS are ignored --
  // an active-but-stale event we simply haven't gotten a fresher read on
  // (fetch outage, cleared without our poller ever seeing it) must not go
  // on surfacing indefinitely.
  const id33MaxAgeMs = ID33_MAX_AGE_HOURS * 3_600_000;
  const activeId33Events = (
    await database
      .select()
      .from(id33Events)
      .where(isNull(id33Events.clearedAt))
      .orderBy(desc(id33Events.id))
  ).filter((e) => {
    const ageMs = nowMs - Date.parse(e.capturedAt);
    return Number.isFinite(ageMs) && ageMs <= id33MaxAgeMs;
  });
  let id33Advisory: string | null = null;
  if (activeId33Events.length > 0) {
    const fullClosure = activeId33Events.find((e) => e.isFullClosure);
    id33Advisory = (fullClosure ?? activeId33Events[0]).description ?? null;
  }

  // Detours only accompany a 'closed' response status, and only the most
  // recent poll cycle's detour rows (not every closure ever recorded).
  let detours: { route: string; conditionText: string }[] | null = null;
  if (status === 'closed' && newest) {
    const freshnessCutoff = new Date(
      Date.parse(newest.capturedAt) - DETOUR_FRESHNESS_MIN * 60_000,
    ).toISOString();
    const detourRows = (
      await env.DB.prepare(
        `SELECT route, condition_text AS conditionText
           FROM detour_snapshots
          WHERE captured_at = (SELECT MAX(captured_at) FROM detour_snapshots)
            AND captured_at >= ?`,
      )
        .bind(freshnessCutoff)
        .all()
    ).results as unknown as DetourRow[];
    detours = detourRows
      .filter((r): r is { route: string; conditionText: string } => r.route !== null && r.conditionText !== null)
      .map((r) => ({ route: r.route, conditionText: r.conditionText }));
  }

  // Forecast. Wrapped in its own try/catch and defaulted to empty: a
  // forecast failure must never fail the status response, which is the
  // one endpoint the home screen depends on.
  let forecast: ForecastDay[] = [];
  let forecastStale = false;
  try {
    const today = denverDateKey(nowMs);
    const forecastRows = (
      await env.DB.prepare(
        `SELECT date, high_f AS highF, low_f AS lowF, category, icon_url AS iconUrl,
                short_forecast AS shortForecast, precip_pct AS precipPct, fetched_at AS fetchedAt
           FROM forecast_days
          WHERE date >= ?
          ORDER BY date
          LIMIT ?`,
      )
        .bind(today, FORECAST_DAYS)
        .all()
    ).results as unknown as {
      date: string;
      highF: number | null;
      lowF: number | null;
      category: string;
      iconUrl: string | null;
      shortForecast: string | null;
      precipPct: number | null;
      fetchedAt: string;
    }[];

    forecast = forecastRows.map((row) => ({
      date: row.date,
      highF: row.highF,
      lowF: row.lowF,
      category: row.category as ForecastDay['category'],
      // Rewritten here, never in the DB: the stored value is NWS's own URL,
      // and the client must only ever be handed a path on our origin.
      iconPath: toIconPath(row.iconUrl),
      shortForecast: row.shortForecast,
      precipPct: row.precipPct,
    }));

    // Staleness keys on the freshest row we hold, not on the rows returned
    // above -- MAX(fetched_at) is read from the whole table, independent of
    // the `date >= today` filter those rows were selected with. The
    // `forecast.length > 0` guard below means an all-past-dates table (or an
    // empty one) reports forecastStale: false, same as having no forecast
    // opinion at all -- there is nothing rendered for staleness to qualify.
    const newestFetch = (await env.DB.prepare(
      'SELECT MAX(fetched_at) AS fetchedAt FROM forecast_days',
    ).first()) as { fetchedAt: string | null } | null;
    if (newestFetch?.fetchedAt && forecast.length > 0) {
      const ageMs = nowMs - Date.parse(newestFetch.fetchedAt);
      forecastStale = !Number.isFinite(ageMs) || ageMs > FORECAST_STALE_HOURS * 3_600_000;
    }
  } catch (err) {
    console.error('[status] forecast read failed', err);
    forecast = [];
    forecastStale = false;
  }

  // Community reports are pure display data here -- this NEVER feeds back
  // into `status`/`isStale`/`pollerDead`/etc above; only WYDOT-derived data
  // drives those fields.
  const alerts = await getActiveAlerts(env, nowMs);

  return {
    status,
    isStale,
    pollerDead,
    generatedAt: new Date(nowMs).toISOString(),
    // See ApiStatus.shareCode's own comment: withheld (null) whenever
    // there's no snapshot, or the poller is dead -- both cases where "share
    // what I'm currently looking at" wouldn't actually be sharing anything
    // current.
    shareCode: newest && !pollerDead ? formatShareCode(newest.capturedAt) : null,
    lastConfirmed,
    conditionText,
    surfaceCondition,
    advisories,
    restrictions,
    wydotReportTime,
    weather,
    weatherStale,
    travelTimes,
    id33Advisory,
    detours,
    alerts,
    forecast,
    forecastStale,
  };
}
