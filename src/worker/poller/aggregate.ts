import type { Env } from '../env';
import { denverDateKey, denverParts } from '../tz';

/**
 * Nearest-rank percentile of a value ALREADY sorted ascending. For a
 * sorted array of `n` values, the p-th percentile is the value at 1-based
 * rank `ceil(p/100 * n)` (clamped to `[1, n]`), i.e. 0-based index
 * `ceil(p/100 * n) - 1`. Example: n=5, sorted [1800,1900,2000,2100,2200]:
 *   p50 -> rank ceil(2.5)=3  -> index 2 -> 2000
 *   p25 -> rank ceil(1.25)=2 -> index 1 -> 1900
 *   p75 -> rank ceil(3.75)=4 -> index 3 -> 2100
 * (test/worker/aggregate.test.ts pins this exact example.)
 */
export function nearestRank(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAsc[rank - 1];
}

const DAY_MS = 24 * 3_600_000;

/** 2 years, subtracted as a calendar interval (UTC full-year subtraction,
 *  not a fixed day count) so it lands on the same month/day 2 years back
 *  regardless of leap years. */
function retentionCutoffMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return d.getTime();
}

/**
 * Rolling window, in days, that `rebuildTypicals` scans out of
 * `travel_times` (audit finding 6 -- unbounded aggregation: the old code
 * pulled the entire table into memory every night, and `travel_times` is
 * never pruned, so that scan/allocation grew forever). Typicals are
 * seasonal medians, so a full year keeps every weekday-class/hour/season
 * combination represented at least once while capping both the SQL scan
 * and the in-memory row set to a fixed size regardless of how much history
 * has piled up. `travel_times` itself is intentionally NOT pruned to this
 * window or any other -- see `applyRetention`'s comment -- this constant
 * only bounds what one rebuild reads, not what's kept.
 */
const TYPICALS_WINDOW_DAYS = 365;

function typicalsCutoffIso(nowMs: number): string {
  return new Date(nowMs - TYPICALS_WINDOW_DAYS * DAY_MS).toISOString();
}

interface TravelTimeRow {
  capturedAt: string;
  durationSec: number;
}

interface TypicalGroupMeta {
  weekdayClass: 'weekday' | 'weekend';
  hour: number;
  season: 'winter' | 'summer';
}

/** Metric column name -> the `metric` value stored in weather_typicals.
 *  Keyed on the DB column so adding a metric is one entry here plus the
 *  column already existing, with no schema change. */
const WEATHER_METRICS = ['air_f', 'surface_f', 'dew_point_f', 'humidity_pct'] as const;

interface WeatherRow {
  capturedAt: string;
  air_f: number | null;
  surface_f: number | null;
  dew_point_f: number | null;
  humidity_pct: number | null;
}

/**
 * Rebuilds `weather_typicals` from the trailing TYPICALS_WINDOW_DAYS of
 * `weather_snapshots`, mirroring `rebuildTypicals`: DELETE everything, then
 * recompute one row per (metric, weekday-class, hour, season) group, with
 * `sample_count` and `distinct_days` alongside the percentiles so the chart
 * can gate its band per bucket.
 *
 * A null reading contributes nothing -- not a zero, and not a row. A bucket
 * with no non-null readings for a metric simply does not exist, which is
 * how the API reports "we have no data for this" rather than claiming a
 * measurement of zero.
 *
 * Collected into the SAME statements array as the route rebuild so both
 * tables land in one `env.DB.batch(...)` transaction -- a concurrent reader
 * must never see one rebuilt and the other half-deleted.
 */
async function weatherTypicalStatements(env: Env, nowMs: number): Promise<D1PreparedStatement[]> {
  const cutoffIso = typicalsCutoffIso(nowMs);
  const rows = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, air_f, surface_f, dew_point_f, humidity_pct
         FROM weather_snapshots WHERE captured_at >= ?`,
    )
      .bind(cutoffIso)
      .all()
  ).results as unknown as WeatherRow[];

  const insert = env.DB.prepare(
    `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75, sample_count, distinct_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const values = new Map<string, number[]>();
  const days = new Map<string, Set<string>>();
  const meta = new Map<string, { metric: string; weekdayClass: string; hour: number; season: string }>();

  for (const row of rows) {
    const capturedMs = Date.parse(row.capturedAt);
    if (!Number.isFinite(capturedMs)) continue; // same defensive skip as the route rebuild
    const { weekdayClass, hour, season } = denverParts(capturedMs);
    const dayKey = denverDateKey(capturedMs);

    for (const metric of WEATHER_METRICS) {
      const reading = row[metric];
      if (reading === null || reading === undefined) continue;
      const key = `${metric}|${weekdayClass}|${hour}|${season}`;
      if (!values.has(key)) {
        values.set(key, []);
        days.set(key, new Set());
        meta.set(key, { metric, weekdayClass, hour, season });
      }
      values.get(key)!.push(reading);
      days.get(key)!.add(dayKey);
    }
  }

  const statements = [env.DB.prepare('DELETE FROM weather_typicals')];
  for (const [key, readings] of values) {
    const m = meta.get(key)!;
    const sorted = [...readings].sort((a, b) => a - b);
    statements.push(
      insert.bind(
        m.metric,
        m.weekdayClass,
        m.hour,
        m.season,
        nearestRank(sorted, 50),
        nearestRank(sorted, 25),
        nearestRank(sorted, 75),
        readings.length,
        days.get(key)!.size,
      ),
    );
  }
  return statements;
}

/**
 * Rebuilds `route_typicals` AND `weather_typicals` from their respective
 * source tables within the last `TYPICALS_WINDOW_DAYS`: DELETE every row of
 * both, then recompute one row per (route|metric, weekday-class, hour,
 * season) group present in that window. Both tables share this single
 * function -- and the single batch below -- because a concurrent reader
 * (GET /api/status, GET /api/weather-history, or this job's next run) must
 * never observe one table freshly rebuilt while the other is mid-delete.
 *
 * Bounding + memory shape (audit finding 6): the SELECT carries a
 * `captured_at >= cutoff` predicate, so D1 never scans more than a
 * year of rows, and the query additionally runs per-route (route ids are
 * discovered via one DISTINCT query over the same window) rather than one
 * query for every route's history at once -- each route's row/group arrays
 * are scoped to that loop iteration and become GC-eligible before the next
 * route's query runs, so peak memory is one route-year (at current volumes,
 * tens of thousands of rows) instead of all-routes-times-all-history.
 * Groups are still formed in TS (derive each row's Denver-local dimensions,
 * group in memory) rather than in SQL, per the original brief -- SQLite/D1
 * has no native percentile aggregate, so the grouping has to happen
 * somewhere, and per-route TS grouping is simpler than a SQL GROUP BY here.
 * `weatherTypicalStatements` groups the same way, just over the single
 * (unpartitioned) weather station instead of per-route.
 *
 * Transaction choice (unchanged from before this fix): the DELETEs and every
 * rebuilt INSERT for both tables are collected into ONE array passed to a
 * single `env.DB.batch(...)` call -- D1 runs the whole array as one implicit
 * transaction, so a failure partway through can never leave either table
 * half-deleted/half-rebuilt for a concurrent reader. Only the *source scan*
 * feeding these statements changed; statement count is still bounded by the
 * group count (a dozen routes x 2 weekday-classes x 24 hours x 2 seasons =
 * at most ~1152 route rows, plus at most 4 metrics x 2 x 24 x 2 = ~384
 * weather rows), comfortably within D1's per-batch limits, so
 * single-transaction atomicity across the whole rebuild is preserved rather
 * than chunked.
 */
async function rebuildTypicals(env: Env, nowMs: number): Promise<void> {
  const cutoffIso = typicalsCutoffIso(nowMs);

  const routeIdRows = (
    await env.DB.prepare(`SELECT DISTINCT route_id AS routeId FROM travel_times WHERE captured_at >= ?`)
      .bind(cutoffIso)
      .all()
  ).results as unknown as { routeId: number }[];

  const insert = env.DB.prepare(
    `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM route_typicals')];

  for (const { routeId } of routeIdRows) {
    // Scoped to this iteration: `rows`, `groups`, `groupMeta`, and
    // `groupDays` are all per-route and go out of scope (GC-eligible)
    // before the next route's query runs, instead of one array holding
    // every route's year at once.
    const rows = (
      await env.DB.prepare(
        `SELECT captured_at AS capturedAt, duration_sec AS durationSec
           FROM travel_times WHERE route_id = ? AND captured_at >= ?`,
      )
        .bind(routeId, cutoffIso)
        .all()
    ).results as unknown as TravelTimeRow[];

    const groups = new Map<string, number[]>();
    const groupMeta = new Map<string, TypicalGroupMeta>();
    // Distinct Denver days per group. Kept as a parallel Map (rather than
    // widening `groups`) so the existing percentile path is untouched.
    const groupDays = new Map<string, Set<string>>();

    for (const row of rows) {
      const capturedMs = Date.parse(row.capturedAt);
      if (!Number.isFinite(capturedMs)) continue; // defensive: skip an unparsable captured_at rather than throwing
      const { weekdayClass, hour, season } = denverParts(capturedMs);
      const key = `${weekdayClass}|${hour}|${season}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupMeta.set(key, { weekdayClass, hour, season });
        groupDays.set(key, new Set());
      }
      groups.get(key)!.push(row.durationSec);
      groupDays.get(key)!.add(denverDateKey(capturedMs));
    }

    for (const [key, durations] of groups) {
      const meta = groupMeta.get(key)!;
      const sorted = [...durations].sort((a, b) => a - b);
      statements.push(
        insert.bind(
          routeId,
          meta.weekdayClass,
          meta.hour,
          meta.season,
          nearestRank(sorted, 50),
          nearestRank(sorted, 25),
          nearestRank(sorted, 75),
          durations.length,
          groupDays.get(key)!.size,
        ),
      );
    }
  }

  statements.push(...(await weatherTypicalStatements(env, nowMs)));
  await env.DB.batch(statements);
}

/**
 * Retention: prune status/weather/detour snapshots older than 2 years
 * (`captured_at` is an ISO-8601 UTC string, so lexicographic `<` comparison
 * is chronological comparison -- no need to parse it in SQL), and flip any
 * `alerts` row that's still `status = 'active'` but whose `expires_at` has
 * passed to `status = 'expired'`. `travel_times` is NEVER pruned here or
 * anywhere else -- the spec calls for keeping raw travel_times forever, and
 * unlike snapshots there's no reader that needs it bounded: growth there
 * only costs storage (cheap), not compute, because `rebuildTypicals` now
 * reads at most `TYPICALS_WINDOW_DAYS` of it per run regardless of how much
 * total history has accumulated (audit finding 6 -- the unboundedness was in
 * the read path, not the lack of pruning, so this fix bounds the read
 * instead of deleting data the spec says to keep). Batched into one
 * transaction for the same all-or-nothing reason as `rebuildTypicals`.
 */
async function applyRetention(env: Env, nowMs: number): Promise<void> {
  const cutoffIso = new Date(retentionCutoffMs(nowMs)).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  await env.DB.batch([
    env.DB.prepare('DELETE FROM status_snapshots WHERE captured_at < ?').bind(cutoffIso),
    env.DB.prepare('DELETE FROM weather_snapshots WHERE captured_at < ?').bind(cutoffIso),
    env.DB.prepare('DELETE FROM detour_snapshots WHERE captured_at < ?').bind(cutoffIso),
    env.DB
      .prepare(`UPDATE alerts SET status = 'expired' WHERE status = 'active' AND expires_at < ?`)
      .bind(nowIso),
  ]);
}

/**
 * The nightly aggregation job: rebuild `route_typicals` AND
 * `weather_typicals` from the trailing `TYPICALS_WINDOW_DAYS` of
 * `travel_times` and `weather_snapshots` respectively, then apply retention
 * (2y snapshot pruning + alert expiry). Wired to the `10 9 * * *` cron entry
 * in index.ts's `scheduled` dispatcher.
 */
export async function runNightly(env: Env, nowMs: number = Date.now()): Promise<void> {
  await rebuildTypicals(env, nowMs);
  await applyRetention(env, nowMs);
}
