import { denverParts } from '../tz';

/**
 * When the poller asks Google for drive times, and how long a reading counts
 * as current afterwards. Both live here because they are one decision: a
 * reading is only "stale" relative to when the next one was due.
 *
 * Why this is not simply "every cycle": each traffic-aware computeRoutes call
 * bills at $0.01 beyond 5,000 free per month. Polling all 12 route-directions
 * every 10 minutes from 05:00 to 23:00 was 1,296 calls a day, about $350 a
 * month. Drew's ceiling is $100, which is 15,000 calls. This table makes 504
 * calls on a weekday and 312 on a weekend day -- 14,088 in the most expensive
 * kind of month (31 days, 23 weekdays), pinned by
 * test/parsers/routes-schedule.test.ts so the table cannot be edited past the
 * budget without a test saying so.
 *
 * Where the calls went was decided from the 98 days of readings recorded up
 * to 2026-11-15, by how much each hour's drive time moves from one day to the
 * next (the p25-p75 spread in route_typicals):
 *
 *   weekday 07-10, toward Jackson   6-9 min   the morning commute
 *   weekday 16-19, toward Idaho     4-10 min  the evening commute
 *   weekday midday                  2-3 min
 *   05:00, and after 19:00          1-2 min
 *   weekends, all day               1-2.5 min
 *
 * The commutes are one-directional -- during the morning rush the
 * Idaho-bound routes move about a minute -- so only the rush direction gets
 * the 10-minute cadence. That is most of the saving.
 *
 * KNOWN GAP: the winter evidence behind this was 10 weekdays and 4 weekend
 * days of early November, before ski season. Ski-season weekends and storm
 * days may not look like the table above. Re-check the bands against
 * route_typicals once a month or two of winter has been recorded.
 *
 * Every band starts and ends on the hour, and every cadence divides 60, so
 * the first tick of a band (hh:00) is always due under both the band before
 * it and the band itself. `travelTimeFreshnessMs` depends on that: it means
 * the reading after one captured at T is never due later than T + the cadence
 * in force at T. Keep both properties if the table changes.
 */

export type RouteDirection = 'eb' | 'wb';

/** [fromHour, toHour) in America/Denver, and minutes between polls. */
type Band = readonly [fromHour: number, toHour: number, cadenceMin: 10 | 30 | 60];

// 'eb' runs Idaho -> Jackson side (see seed-routes.ts), i.e. the morning
// commute; 'wb' is the evening one.
const WEEKDAY_BANDS: Record<RouteDirection, readonly Band[]> = {
  eb: [
    [5, 6, 60],
    [6, 7, 30],
    [7, 10, 10],
    [10, 19, 30],
    [19, 22, 60],
  ],
  wb: [
    [5, 6, 60],
    [6, 16, 30],
    [16, 19, 10],
    [19, 22, 60],
  ],
};

const WEEKEND_BANDS: readonly Band[] = [
  [5, 9, 60],
  [9, 18, 30],
  [18, 22, 60],
];

/** The poller's own tick. wrangler.toml's crons fire every 10 minutes through
 *  every hour this table covers (the 15-minute entry is 00:00-04:59 Denver). */
const TICK_MIN = 10;

/**
 * Minutes between polls for `direction` at `ms`, or null when drive times are
 * not polled at all (22:00-05:00 America/Denver).
 */
export function routeCadenceMin(ms: number, direction: RouteDirection): number | null {
  const { hour, weekdayClass } = denverParts(ms);
  const bands = weekdayClass === 'weekend' ? WEEKEND_BANDS : WEEKDAY_BANDS[direction];
  const band = bands.find(([from, to]) => hour >= from && hour < to);
  return band ? band[2] : null;
}

/**
 * True when the poll cycle running at `ms` should fetch `direction`'s routes.
 *
 * `ms` is the cycle's own `Date.now()`, which lands some seconds after the
 * cron's nominal minute (real rows are stamped hh:50:24, not hh:50:00), so
 * the minute is floored to its tick before the cadence test.
 *
 * The UTC minute is used as the Denver minute. America/Denver is a
 * whole-hour offset in both standard and daylight time, so the two are
 * always equal.
 */
export function isRouteDue(ms: number, direction: RouteDirection): boolean {
  const cadence = routeCadenceMin(ms, direction);
  if (cadence === null) return false;
  const minute = new Date(ms).getUTCMinutes();
  const tick = Math.floor(minute / TICK_MIN) * TICK_MIN;
  return tick % cadence === 0;
}

/** A reading is never called stale sooner than this, whatever the cadence.
 *  It is the pre-schedule threshold: at the 10-minute cadence it tolerates two
 *  missed cycles before a rush-hour number is muted. */
const FRESHNESS_FLOOR_MIN = 30;

/** How overdue the next reading may be before the current one is called
 *  stale. One tick: a single slow or failed cycle should not mute a number. */
const FRESHNESS_GRACE_MIN = 10;

/**
 * How long a reading captured at `capturedAtMs` counts as current.
 *
 * It is the cadence in force when the reading was taken, plus a grace tick,
 * so a half-hourly reading is fresh for 40 minutes and an hourly one for 70.
 * A fixed 30 minutes -- correct when everything was polled every 10 --
 * would mute every half-hourly reading just as its replacement arrived, and
 * every hourly one for half of each hour, and would strip the
 * comparison-to-typical from both (status.ts forces `typicalSec` null on a
 * stale row).
 *
 * The longer windows are confined to the hours where drive times barely move
 * (see the table at the top of this file), and the page still prints the
 * reading's own time ("Updated 12:00 PM"), so an older number is never
 * presented as newer than it is.
 *
 * A reading captured outside the schedule -- rows from before it existed,
 * when polling ran to 23:00 -- gets the floor.
 */
export function travelTimeFreshnessMs(capturedAtMs: number, direction: RouteDirection): number {
  const cadence = routeCadenceMin(capturedAtMs, direction);
  const minutes =
    cadence === null ? FRESHNESS_FLOOR_MIN : Math.max(FRESHNESS_FLOOR_MIN, cadence + FRESHNESS_GRACE_MIN);
  return minutes * 60_000;
}

/** The longest any reading can count as current: an hourly one. For callers
 *  that need a bound before they know which reading they are looking at. */
export const MAX_TRAVEL_TIME_FRESHNESS_MS = (60 + FRESHNESS_GRACE_MIN) * 60_000;
