import { and, desc, eq, gte, lt } from 'drizzle-orm';

import type { PassStatus } from '../../shared/types';
import { db, statusSnapshots } from '../db';
import type { Env } from '../env';
import { formatShareCode, shareCodeToUtcWindow } from '../share-code';
import type { CardInput, CardRoute } from './render';

/** Width of the DB scan on either side of the share code's constant-offset
 *  window guess (`shareCodeToUtcWindow`'s `start`). This guess is exactly
 *  right on every ordinary day, but on the ~2 DST-transition days/year it
 *  can be off in either direction:
 *  - Spring-forward: the guess can land up to 1h AFTER the true instant
 *    (the day's midnight is still pre-jump standard time, so the guess's
 *    constant offset overshoots once the code's HH:mm is past the jump).
 *  - Fall-back: the repeated 1:00-1:59am local hour means TWO distinct real
 *    snapshots (one before the jump, one after, exactly 1h apart) can
 *    format to the identical code -- the guess only ever lands on the
 *    FIRST (older) of the two.
 *  Wide enough to comfortably contain every real candidate on either side;
 *  rows in this range are then filtered in code by re-formatting each one's
 *  own `capturedAt` and comparing it to the requested code, so the width
 *  here is a performance/safety margin, not a source of false matches. */
const WINDOW_BEFORE_MS = 2 * 3_600_000;
const WINDOW_AFTER_MS = 3 * 3_600_000;

/** Travel-time rows within this many minutes of the snapshot's own
 *  `capturedAt` count as "that cycle's" reading for a route (design doc:
 *  "its cycle's travel_times, rows within ±5 min of the snapshot's captured
 *  _at"). Independent of `TRAVEL_TIME_FRESHNESS_MIN` in api/status.ts --
 *  that constant governs "is this fresh enough to show as LIVE right now";
 *  this one instead pairs a historical snapshot with the travel times that
 *  were actually captured alongside it, however long ago that was. */
const ROUTE_WINDOW_MIN = 5;

interface TravelTimeRow {
  routeId: number;
  slug: string;
  name: string;
  durationSec: number;
  capturedAt: string;
}

/** Parse a JSON-array-of-strings column defensively: malformed/absent JSON,
 *  or JSON that isn't an array of strings, resolves to `[]` rather than
 *  throwing. Byte-identical logic to (but a separate copy from) api/
 *  status.ts's private `safeStringArray` -- not exported/shared from there,
 *  same "small enough to just duplicate" precedent as this module's `esc`
 *  in render.ts already following seo-inject.ts's. */
function safeStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** The card's "as of" is the snapshot's OWN capture time -- the minute the
 *  share code encodes, and when the card's drive times were fetched. It
 *  deliberately does NOT prefer wydotReportTime the way seo-inject.ts and
 *  the in-app weather panel do: WYDOT's report timestamp only moves when
 *  their report changes, so on quiet days it lags hours behind and made
 *  fresh shares read as stale (Drew-reported, 2026-08-11 -- card said
 *  "as of 11:54 AM" at 2:42 PM over minutes-old drive times). Status-side
 *  honesty is unaffected: a genuinely stale status degrades the card via
 *  the existing staleness handling, not via this footer stamp. */
function resolveAsOfIso(capturedAt: string): string {
  return capturedAt;
}

/**
 * Resolves a share code (`YYYYMMDD-HHmm`, America/Denver) to the
 * `status_snapshots.id` it names, or `null` if the code is malformed or
 * names no snapshot.
 *
 * Deliberately does NOT short-circuit on the constant-offset window guess
 * (`shareCodeToUtcWindow`'s `[start, end)`) alone: on fall-back night, that
 * guess only ever lands on the FIRST of two distinct real snapshots that
 * can share the same code (see `WINDOW_BEFORE_MS`/`WINDOW_AFTER_MS`'s
 * comment), so trusting a hit there without also checking the rest of the
 * window would silently return the OLDER snapshot on that one night/year.
 * Instead, every row across the whole bounded window is fetched (newest
 * first), each candidate's OWN code is re-derived via `formatShareCode`,
 * and the first (i.e. newest, highest id) exact string match wins --
 * correct on an ordinary day (where at most one row is ever in range and
 * poller cadence never runs faster than every 5min, so two snapshots
 * sharing one Denver-local minute is impossible there anyway) and on both
 * kinds of DST-transition day. No match anywhere -> `null`; callers
 * (route.ts) turn that into the same 404/redirect as a request that never
 * touched the DB at all.
 */
export async function resolveShareCode(env: Env, code: string): Promise<number | null> {
  const window = shareCodeToUtcWindow(code);
  if (!window) return null;

  const database = db(env);

  const rows = await database
    .select({ id: statusSnapshots.id, capturedAt: statusSnapshots.capturedAt })
    .from(statusSnapshots)
    .where(
      and(
        gte(statusSnapshots.capturedAt, new Date(window.start - WINDOW_BEFORE_MS).toISOString()),
        lt(statusSnapshots.capturedAt, new Date(window.start + WINDOW_AFTER_MS).toISOString()),
      ),
    )
    .orderBy(desc(statusSnapshots.id));

  const match = rows.find((row) => formatShareCode(row.capturedAt) === code);
  return match ? match.id : null;
}

/**
 * Loads everything `buildCardHtml` needs for `/og/{id}-{dir}.png` and
 * `/s/{id}`: the snapshot itself plus its cycle's travel times, filtered to
 * the 4 non-airport routes in the given direction (Drew-approved scope --
 * see design doc's "Jackson-bound 4 routes"). Returns `null` when `id`
 * doesn't match any `status_snapshots` row -- the only "not found" case;
 * callers (route.ts) turn that into a 404/redirect as appropriate. Never
 * throws for "no travel times" -- `routes` is simply `[]` in that case (the
 * design doc's "zero rows → omit section").
 */
export async function loadCardData(
  env: Env,
  id: number,
  dir: 'eb' | 'wb',
): Promise<CardInput | null> {
  const database = db(env);
  const [snapshot] = await database
    .select()
    .from(statusSnapshots)
    .where(eq(statusSnapshots.id, id))
    .limit(1);
  if (!snapshot) return null;

  const capturedMs = Date.parse(snapshot.capturedAt);
  const windowMs = ROUTE_WINDOW_MIN * 60_000;
  const lowerBound = new Date(capturedMs - windowMs).toISOString();
  const upperBound = new Date(capturedMs + windowMs).toISOString();

  const rows = (
    await env.DB.prepare(
      `SELECT r.id AS routeId, r.slug AS slug, r.name AS name,
              t.duration_sec AS durationSec, t.captured_at AS capturedAt
         FROM travel_times t
         INNER JOIN routes r ON r.id = t.route_id
        WHERE r.direction = ?
          AND r.slug NOT LIKE '%airport%'
          AND t.captured_at BETWEEN ? AND ?
        ORDER BY r.id ASC`,
    )
      .bind(dir, lowerBound, upperBound)
      .all()
  ).results as unknown as TravelTimeRow[];

  // A route can have more than one row inside the ±5min window (overlapping
  // poll cycles); keep only the one closest to the snapshot's own
  // capturedAt per route, first-seen-wins order otherwise (rows arrive
  // ORDER BY r.id ASC, i.e. seed order -- see seed-routes.ts's PAIRS array).
  const byRoute = new Map<number, TravelTimeRow>();
  for (const row of rows) {
    const existing = byRoute.get(row.routeId);
    if (!existing) {
      byRoute.set(row.routeId, row);
      continue;
    }
    const existingDiff = Math.abs(Date.parse(existing.capturedAt) - capturedMs);
    const rowDiff = Math.abs(Date.parse(row.capturedAt) - capturedMs);
    if (rowDiff < existingDiff) byRoute.set(row.routeId, row);
  }
  const cardRoutes: CardRoute[] = rows
    .filter((row) => byRoute.get(row.routeId) === row)
    .map((row) => ({ name: row.name, durationSec: row.durationSec }));

  const input: CardInput = {
    status: snapshot.status as PassStatus,
    restrictions: safeStringArray(snapshot.restrictions),
    routes: cardRoutes,
    asOfIso: resolveAsOfIso(snapshot.capturedAt),
  };
  return input;
}
