import { eq } from 'drizzle-orm';

import { db, routes, routeTypicals } from '../db';
import type { Env } from '../env';
import { denverMidnightMs } from '../tz';

export interface HistoryTypical {
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
}

export interface HistoryToday {
  capturedAt: string;
  durationSec: number;
}

export interface HistoryResult {
  route: { slug: string; name: string };
  typicals: HistoryTypical[];
  today: HistoryToday[];
}

interface TodayRow {
  capturedAt: string;
  durationSec: number;
}

/**
 * Assembles `GET /api/history?route=<slug>`. Returns `null` for an unknown
 * slug -- the caller (router.ts) turns that into a 404.
 *
 * `today` = every `travel_times` row for this route captured since
 * Denver-local midnight (per `nowMs`, defaulting to real time), ascending by
 * `captured_at`.
 */
export async function getHistory(
  env: Env,
  slug: string,
  nowMs: number = Date.now(),
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

  return {
    route: { slug: route.slug, name: route.name },
    typicals,
    today: todayRows,
  };
}
