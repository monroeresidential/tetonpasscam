/**
 * Shared America/Denver time-zone derivations, consolidated out of
 * google-routes.ts (Task 6, hour extraction for `inPollingWindow`) and
 * status.ts (Task 9, weekday-class/hour/season extraction for
 * `denverTypicalsKey`). Both modules now delegate to this file; their own
 * exported functions keep their existing names/signatures so no caller
 * (production or test) needs to change, only the internals moved.
 *
 * `denverToUtcIso` (wydot-status.ts, Task 3) stays where it is -- it parses
 * a WYDOT wall-clock string INTO a UTC instant (the reverse direction from
 * everything here, which takes an epoch ms instant and reads Denver-local
 * fields OUT of it), and duplicating/importing across that seam wasn't part
 * of this task's scope.
 */

const DENVER_PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  hourCycle: 'h23',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});

export interface DenverParts {
  hour: number; // 0-23, America/Denver wall-clock hour
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
}

/**
 * Derive the (hour, weekday-class, season) triple used by both the polling
 * window and the typicals lookup/rebuild, all read from a single
 * Intl.DateTimeFormat pass over `ms` in America/Denver (DST-aware). Season
 * follows the brief's Nov-Apr = winter / May-Oct = summer split (same as
 * the original status.ts `denverTypicalsKey`).
 */
export function denverParts(ms: number): DenverParts {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = Number(get('hour'));
  const month = Number(get('month'));
  return {
    hour,
    weekdayClass: weekday === 'Sat' || weekday === 'Sun' ? 'weekend' : 'weekday',
    season: month >= 11 || month <= 4 ? 'winter' : 'summer',
  };
}

/** Just the hour component of `denverParts` -- used by `inPollingWindow`. */
export function denverHour(ms: number): number {
  return denverParts(ms).hour;
}

/** Get America/Denver's UTC offset in minutes (negative west of UTC) for the
 *  given instant. Same technique as wydot-status.ts's private helper of the
 *  same name/shape, kept as a separate small copy here rather than exported
 *  from that parse-direction module (different concern, per the brief). */
function getDenverOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    timeZoneName: 'shortOffset',
  });
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-7';
  const match = part.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -7;
  return hours * 60;
}

/**
 * The UTC epoch ms of local midnight (00:00:00) America/Denver for the
 * Denver-local calendar day containing `ms`. DST-aware via the same
 * guess-then-correct convergence wydot-status.ts's `denverToUtcIso` uses
 * (a wall-clock instant treated as UTC can land on the wrong side of a DST
 * transition; re-deriving the offset at the corrected instant and
 * re-applying once more converges correctly across both spring-forward and
 * fall-back).
 */
export function denverMidnightMs(ms: number): number {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const year = get('year');
  const month = get('month'); // 1-12
  const day = get('day');

  const guessUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = getDenverOffsetMinutes(new Date(guessUtcMs));
  let actualUtcMs = guessUtcMs - firstOffset * 60_000;
  const secondOffset = getDenverOffsetMinutes(new Date(actualUtcMs));
  if (secondOffset !== firstOffset) {
    actualUtcMs = guessUtcMs - secondOffset * 60_000;
  }
  return actualUtcMs;
}

/**
 * 'YYYY-MM-DD' for the America/Denver calendar day containing `ms`. Used to
 * group readings by local day (aggregate.ts's distinct-day count, and
 * history.ts's per-day peaks). Deliberately NOT `toISOString().slice(0,10)`
 * -- that is the UTC day, which splits a Denver evening across two keys.
 */
export function denverDateKey(ms: number): string {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = get('year');
  const m = get('month').padStart(2, '0');
  const d = get('day').padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Denver-local midnight on the first day of the season containing `ms`,
 * matching `denverParts`'s Nov-Apr = winter / May-Oct = summer split.
 * Winter spans the year boundary, so a Jan-Apr instant belongs to the
 * season that began the PREVIOUS November.
 */
export function denverSeasonStartMs(ms: number): number {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const year = get('year');
  const month = get('month'); // 1-12

  const startYear = month >= 1 && month <= 4 ? year - 1 : year;
  const startMonth = month >= 5 && month <= 10 ? 5 : 11;
  // Noon avoids any DST edge at the boundary date; denverMidnightMs then
  // walks back to that Denver day's true local midnight.
  return denverMidnightMs(Date.UTC(startYear, startMonth - 1, 1, 12, 0, 0));
}
