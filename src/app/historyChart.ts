import type { ChartPoint } from './components/TypicalChart';
import type { HistoryToday, HistoryTypical } from '../shared/types';

/**
 * Denver-local weekday-class + season for a given instant (defaults to now).
 * Same Nov-Apr/May-Oct split as the worker's tz.ts denverParts. Shared by
 * HistoryPage and HomeHistoryCard -- both must filter `/api/history`'s
 * typicals down to this SAME population before plotting (see
 * `typicalsToChartPoints`), so there is exactly one place this derivation
 * lives.
 */
export function denverNow(now: Date = new Date()): {
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'numeric',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Monday';
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  return {
    weekday,
    weekdayClass: weekday === 'Saturday' || weekday === 'Sunday' ? 'weekend' : 'weekday',
    season: month >= 11 || month <= 4 ? 'winter' : 'summer',
  };
}

/**
 * Denver-local hour-of-day for an ISO instant, as a FRACTIONAL hour
 * (hour + minutes/60) rather than a whole hour. The poller captures roughly
 * six `travel_times` readings per hour, so plotting them all at the same
 * integer x-coordinate renders "today" as a comb of vertical spikes instead
 * of a line. Only used for `today` readings -- typicals stay keyed on the
 * worker's whole-hour bucket (see `typicalsToChartPoints`), and `bandRuns`
 * must never see a fractional hour.
 */
export function denverFractionalHourOf(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour + minute / 60;
}

/**
 * Filters `/api/history`'s `typicals` -- every (weekday-class, hour, season)
 * bucket for the route -- down to the ONE population matching
 * `weekdayClass`/`season`, then maps to `ChartPoint`.
 *
 * `/api/history` deliberately returns every combination for a route, so a
 * consumer that skips this filter plots weekday and weekend (and winter and
 * summer) buckets at the same x-coordinate: the median polyline zig-zags
 * between unrelated populations and `bandRuns` sees a non-contiguous hour
 * sequence, emitting alternating band slivers that mix populations that
 * were never meant to share an axis. Do not duplicate this filter at a
 * second call site -- that duplication is exactly how this bug happened
 * once already.
 */
export function typicalsToChartPoints(
  typicals: HistoryTypical[],
  weekdayClass: 'weekday' | 'weekend',
  season: 'winter' | 'summer',
): ChartPoint[] {
  return typicals
    .filter((t) => t.weekdayClass === weekdayClass && t.season === season)
    .sort((a, b) => a.hour - b.hour)
    .map((t) => ({
      hour: t.hour,
      median: t.medianSec,
      p25: t.p25Sec,
      p75: t.p75Sec,
      distinctDays: t.distinctDays,
    }));
}

/**
 * Maps `/api/history`'s `today` rows to chart points, each plotted at its
 * fractional Denver-local hour (see `denverFractionalHourOf`) rather than
 * snapped to the whole-hour bucket the typicals band uses.
 */
export function todayToChartPoints(today: HistoryToday[]): { hour: number; value: number }[] {
  return today.map((r) => ({ hour: denverFractionalHourOf(r.capturedAt), value: r.durationSec }));
}
