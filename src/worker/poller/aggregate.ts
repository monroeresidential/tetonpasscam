import type { Env } from '../env';
import { denverParts } from '../tz';

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

/**
 * Rebuilds `route_typicals` from `travel_times` history within the last
 * `TYPICALS_WINDOW_DAYS`: DELETE every row, then recompute one row per
 * (route, weekday-class, hour, season) group present in that window.
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
 *
 * Transaction choice (unchanged from before this fix): the DELETE and every
 * rebuilt INSERT are still collected into ONE array passed to a single
 * `env.DB.batch(...)` call -- D1 runs the whole array as one implicit
 * transaction, so a failure partway through can never leave
 * `route_typicals` half-deleted/half-rebuilt for a concurrent reader
 * (GET /api/status's typicals lookup, or this job's next run). Only the
 * *source scan* feeding these statements changed; statement count is still
 * bounded by the group count (a dozen routes x 2 weekday-classes x 24
 * hours x 2 seasons = at most ~1152 rows), comfortably within D1's
 * per-batch limits, so single-transaction atomicity across the whole
 * rebuild is preserved rather than chunked.
 */
async function rebuildTypicals(env: Env, nowMs: number): Promise<void> {
  const cutoffIso = typicalsCutoffIso(nowMs);

  const routeIdRows = (
    await env.DB.prepare(`SELECT DISTINCT route_id AS routeId FROM travel_times WHERE captured_at >= ?`)
      .bind(cutoffIso)
      .all()
  ).results as unknown as { routeId: number }[];

  const insert = env.DB.prepare(
    `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM route_typicals')];

  for (const { routeId } of routeIdRows) {
    // Scoped to this iteration: `rows`, `groups`, and `groupMeta` are all
    // per-route and go out of scope (GC-eligible) before the next route's
    // query runs, instead of one array holding every route's year at once.
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

    for (const row of rows) {
      const capturedMs = Date.parse(row.capturedAt);
      if (!Number.isFinite(capturedMs)) continue; // defensive: skip an unparsable captured_at rather than throwing
      const { weekdayClass, hour, season } = denverParts(capturedMs);
      const key = `${weekdayClass}|${hour}|${season}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupMeta.set(key, { weekdayClass, hour, season });
      }
      groups.get(key)!.push(row.durationSec);
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
        ),
      );
    }
  }

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
 * The nightly aggregation job: rebuild `route_typicals` from the trailing
 * `TYPICALS_WINDOW_DAYS` of `travel_times`, then apply retention (2y
 * snapshot pruning + alert expiry). Wired to the `10 9 * * *` cron entry in
 * index.ts's `scheduled` dispatcher.
 */
export async function runNightly(env: Env, nowMs: number = Date.now()): Promise<void> {
  await rebuildTypicals(env, nowMs);
  await applyRetention(env, nowMs);
}
