/**
 * Datetime share codes: `/s/{code}` and `/og/{code}-{dir}.png` identify a
 * `status_snapshots` row by its `captured_at`, rendered in America/Denver as
 * `YYYYMMDD-HHmm` -- the same wall-clock the card footer's "as of" timestamp
 * shows, so the URL itself reads as "when" to a human. Replaces the old raw
 * numeric `status_snapshots.id` (share-cards T1/T2) entirely; nothing
 * outside this worker ever depended on the numeric id, so there's no
 * back-compat shim -- an old `/s/{n}` fails the strict format check below
 * and falls through to the caller's not-found path.
 *
 * Encode (`formatShareCode`) and decode (`shareCodeToUtcWindow`) are kept in
 * this one module so the two directions can't drift apart.
 */

import { denverMidnightMs } from './tz';

/** Strict shape check: exactly 8 digits, a literal hyphen, exactly 4 digits.
 *  Any other string (old numeric ids, path traversal, SQL-injection-shaped
 *  input, empty string, etc.) fails this before any DB is ever touched --
 *  callers should run this (or the equivalent route regex) before doing any
 *  lookup. */
const SHARE_CODE_RE = /^\d{8}-\d{4}$/;

export function isValidShareCodeFormat(code: string): boolean {
  return SHARE_CODE_RE.test(code);
}

const DENVER_DATE_PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Encode a snapshot's `capturedAt` (an ISO UTC instant) as its share code:
 * the America/Denver wall-clock reading of that instant, `YYYYMMDD-HHmm`.
 */
export function formatShareCode(capturedAtIso: string): string {
  const ms = Date.parse(capturedAtIso);
  const parts = DENVER_DATE_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  return `${get('year')}${get('month')}${get('day')}-${hour}${minute}`;
}

export interface ShareCodeWindow {
  /** Inclusive UTC epoch ms lower bound. */
  start: number;
  /** Exclusive UTC epoch ms upper bound (always `start + 60_000`). */
  end: number;
}

/**
 * Decode a share code into the UTC instant range (`[start, end)`, a single
 * Denver-local minute wide) that a matching `status_snapshots.captured_at`
 * should fall in -- the PRIMARY window only. This assumes a constant
 * America/Denver UTC offset across the whole calendar day, which is true
 * except on the ~2 DST-transition days/year, where a code whose HH:mm falls
 * on the far side of the transition (from the day's midnight) resolves to a
 * window that's off by exactly the DST delta (1h). Callers must treat "no
 * row found in this window" as inconclusive on those two days and fall back
 * to a wider DB scan compared against `formatShareCode` per-row (see
 * card/data.ts's `resolveShareCode`) -- this function only ever returns the
 * fast-path guess.
 *
 * Returns `null` for a code that fails the strict format check.
 */
export function shareCodeToUtcWindow(code: string): ShareCodeWindow | null {
  if (!isValidShareCodeFormat(code)) return null;

  const year = Number(code.slice(0, 4));
  const month = Number(code.slice(4, 6));
  const day = Number(code.slice(6, 8));
  const hour = Number(code.slice(9, 11));
  const minute = Number(code.slice(11, 13));

  // Noon UTC always falls on calendar day `year-month-day` in America/Denver
  // (Denver is always UTC-6 or UTC-7, so noon UTC is 5am-6am local, same
  // day) -- a safe instant to hand denverMidnightMs to get that Denver-local
  // day's own midnight, regardless of which side of a DST transition noon
  // itself is on.
  const guessUtcMs = Date.UTC(year, month - 1, day, 12, 0, 0);
  const midnightMs = denverMidnightMs(guessUtcMs);
  const start = midnightMs + hour * 3_600_000 + minute * 60_000;
  return { start, end: start + 60_000 };
}
