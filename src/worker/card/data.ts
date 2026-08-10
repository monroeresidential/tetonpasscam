import { eq } from 'drizzle-orm';

import type { PassStatus } from '../../shared/types';
import { db, statusSnapshots } from '../db';
import type { Env } from '../env';
import type { CardInput, CardRoute } from './render';

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

/** Same "prefer WYDOT's own report time, fall back to our capture time"
 *  preference seo-inject.ts's `buildLiveStatusHtml` and api/status.ts's
 *  `getStatus` both already apply -- capturedAt is "when we polled", not
 *  "when WYDOT says this was true". A card's "as of" footer should show the
 *  latter whenever it's trustworthy. */
function resolveAsOfIso(capturedAt: string, wydotReportTime: string | null): string {
  if (wydotReportTime && Number.isFinite(Date.parse(wydotReportTime))) return wydotReportTime;
  return capturedAt;
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
    asOfIso: resolveAsOfIso(snapshot.capturedAt, snapshot.wydotReportTime),
  };
  return input;
}
