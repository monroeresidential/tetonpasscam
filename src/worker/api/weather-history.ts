import type { Env } from '../env';
import type { WeatherHistoryResult, WeatherTypical } from '../../shared/types';
import { denverMidnightMs } from '../tz';

interface TodayRow {
  capturedAt: string;
  airF: number | null;
  surfaceF: number | null;
}

/**
 * Assembles `GET /api/weather-history`. Station-wide, so unlike
 * `/api/history` it takes no route parameter -- the Teton Pass RWIS sensor
 * reports one set of readings for the pass, and hanging them off a `?route=`
 * would imply they differ per route.
 *
 * `today` = every `weather_snapshots` row since Denver-local midnight,
 * ascending. Both queries are naturally bounded: `weather_typicals` holds at
 * most ~96 rows per metric, and `today` is one Denver day of 10-minute polls.
 */
export async function getWeatherHistory(
  env: Env,
  nowMs: number = Date.now(),
): Promise<WeatherHistoryResult> {
  const typicals = (
    await env.DB.prepare(
      `SELECT metric, weekday_class AS weekdayClass, hour, season,
              median, p25, p75, sample_count AS sampleCount, distinct_days AS distinctDays
         FROM weather_typicals`,
    ).all()
  ).results as unknown as WeatherTypical[];

  const todayStartIso = new Date(denverMidnightMs(nowMs)).toISOString();
  const today = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, air_f AS airF, surface_f AS surfaceF
         FROM weather_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC`,
    )
      .bind(todayStartIso)
      .all()
  ).results as unknown as TodayRow[];

  return { typicals, today };
}
