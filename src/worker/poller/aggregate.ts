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

/** 2 years, subtracted as a calendar interval (UTC full-year subtraction,
 *  not a fixed day count) so it lands on the same month/day 2 years back
 *  regardless of leap years. */
function retentionCutoffMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return d.getTime();
}

interface TravelTimeAggRow {
  routeId: number;
  capturedAt: string;
  durationSec: number;
}

interface TypicalGroupMeta {
  routeId: number;
  weekdayClass: 'weekday' | 'weekend';
  hour: number;
  season: 'winter' | 'summer';
}

/**
 * Rebuilds `route_typicals` from scratch out of ALL `travel_times` history:
 * DELETE every row, then recompute one row per (route, weekday-class, hour,
 * season) group actually present in the data. Groups are formed in TS (pull
 * every travel_times row, derive its Denver-local dimensions, group in
 * memory) rather than in SQL -- per the brief, travel_times volume here is
 * small enough (a handful of routes, 10-minute cadence) that this is simpler
 * than a SQL-side GROUP BY + percentile computation SQLite/D1 doesn't
 * natively support anyway.
 *
 * Transaction choice: the DELETE and every rebuilt INSERT are collected into
 * ONE array passed to a single `env.DB.batch(...)` call. D1's batch API runs
 * every statement in the array as one implicit transaction -- either all of
 * them commit or none do -- so a failure partway through (e.g. one bad bind)
 * can never leave `route_typicals` in a half-deleted, half-rebuilt state
 * visible to a concurrent reader (GET /api/status's typicals lookup, or this
 * same job's next run). At current/expected data volumes (a dozen routes x
 * 2 weekday-classes x 24 hours x 2 seasons = at most ~1152 group rows) one
 * batch comfortably fits D1's per-batch limits; if the route count grows
 * enough to matter, this would need chunking (at the cost of losing
 * single-transaction atomicity across chunks).
 */
async function rebuildTypicals(env: Env): Promise<void> {
  const rows = (
    await env.DB.prepare(
      `SELECT route_id AS routeId, captured_at AS capturedAt, duration_sec AS durationSec FROM travel_times`,
    ).all()
  ).results as unknown as TravelTimeAggRow[];

  const groups = new Map<string, number[]>();
  const groupMeta = new Map<string, TypicalGroupMeta>();

  for (const row of rows) {
    const capturedMs = Date.parse(row.capturedAt);
    if (!Number.isFinite(capturedMs)) continue; // defensive: skip an unparsable captured_at rather than throwing
    const { weekdayClass, hour, season } = denverParts(capturedMs);
    const key = `${row.routeId}|${weekdayClass}|${hour}|${season}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupMeta.set(key, { routeId: row.routeId, weekdayClass, hour, season });
    }
    groups.get(key)!.push(row.durationSec);
  }

  const insert = env.DB.prepare(
    `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM route_typicals')];
  for (const [key, durations] of groups) {
    const meta = groupMeta.get(key)!;
    const sorted = [...durations].sort((a, b) => a - b);
    statements.push(
      insert.bind(
        meta.routeId,
        meta.weekdayClass,
        meta.hour,
        meta.season,
        nearestRank(sorted, 50),
        nearestRank(sorted, 25),
        nearestRank(sorted, 75),
      ),
    );
  }

  await env.DB.batch(statements);
}

/**
 * Retention: prune status/weather/detour snapshots older than 2 years
 * (`captured_at` is an ISO-8601 UTC string, so lexicographic `<` comparison
 * is chronological comparison -- no need to parse it in SQL), and flip any
 * `alerts` row that's still `status = 'active'` but whose `expires_at` has
 * passed to `status = 'expired'`. `travel_times` is NEVER pruned here (its
 * full history is exactly what `rebuildTypicals` needs). Batched into one
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
 * The nightly aggregation job: rebuild `route_typicals` from full
 * `travel_times` history, then apply retention (2y snapshot pruning + alert
 * expiry). Wired to the `10 9 * * *` cron entry in index.ts's `scheduled`
 * dispatcher.
 */
export async function runNightly(env: Env, nowMs: number = Date.now()): Promise<void> {
  await rebuildTypicals(env);
  await applyRetention(env, nowMs);
}
