import { describe, expect, it } from 'vitest';

import {
  denverDateKey,
  denverHour,
  denverMidnightMs,
  denverParts,
  denverSeasonStartMs,
} from '../../src/worker/tz';

describe('denverParts', () => {
  it('derives hour/weekday-class/season from America/Denver, DST-aware', () => {
    // Wed Jan 14 2026 07:00 MST (UTC-7) == 14:00 UTC -- weekday, winter.
    expect(denverParts(Date.parse('2026-01-14T14:00:00.000Z'))).toEqual({
      hour: 7,
      weekdayClass: 'weekday',
      season: 'winter',
    });
    // Sat Jan 17 2026 23:30 MST == Sun Jan 18 06:30 UTC -- weekend, winter.
    expect(denverParts(Date.parse('2026-01-18T06:30:00.000Z'))).toEqual({
      hour: 23,
      weekdayClass: 'weekend',
      season: 'winter',
    });
  });
});

describe('denverHour', () => {
  it('matches the hour component of denverParts', () => {
    expect(denverHour(Date.parse('2026-01-14T14:00:00.000Z'))).toBe(7);
  });
});

describe('denverMidnightMs', () => {
  it('returns the correct UTC instant across the spring-forward DST transition', () => {
    // 2026 US DST begins Sunday, March 8 at 02:00 local (jumps to 03:00).
    // A query at 01:00 Denver-local that same morning -- still MST (UTC-7),
    // BEFORE the 02:00 jump -- is 01:00 + 7h == 08:00 UTC.
    const queryAtOneAmLocalMs = Date.parse('2026-03-08T08:00:00.000Z');

    // Midnight (00:00) for that same Denver-local calendar day is also
    // still MST (the transition hasn't happened yet), so local midnight ==
    // 00:00 + 7h == 07:00 UTC that same day.
    const expectedMidnightMs = Date.parse('2026-03-08T07:00:00.000Z');

    expect(denverMidnightMs(queryAtOneAmLocalMs)).toBe(expectedMidnightMs);
  });

  it('lands on the correct calendar day in standard time (non-DST sanity check)', () => {
    // 10:00 MST Jan 15 2026 == 17:00 UTC; Denver-local midnight that day
    // (00:00 MST) == 07:00 UTC same day.
    expect(denverMidnightMs(Date.parse('2026-01-15T17:00:00.000Z'))).toBe(
      Date.parse('2026-01-15T07:00:00.000Z'),
    );
  });
});

describe('denverDateKey', () => {
  it('zero-pads month and day', () => {
    // 2026-08-15T18:00:00Z == 12:00 MDT the same day
    expect(denverDateKey(Date.parse('2026-08-15T18:00:00.000Z'))).toBe('2026-08-15');
    expect(denverDateKey(Date.parse('2026-01-05T19:00:00.000Z'))).toBe('2026-01-05');
  });

  it('uses the Denver day, not the UTC day', () => {
    // 2026-08-16T04:00:00Z is 22:00 MDT on Aug 15 -- UTC has already
    // rolled over, Denver has not. Grouping by UTC here would split one
    // evening's readings across two "days".
    expect(denverDateKey(Date.parse('2026-08-16T04:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('denverSeasonStartMs', () => {
  it('summer instant => May 1 of the same year, Denver midnight', () => {
    const start = denverSeasonStartMs(Date.parse('2026-08-15T18:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2026-05-01');
  });

  it('Nov-Dec winter instant => Nov 1 of the same year', () => {
    const start = denverSeasonStartMs(Date.parse('2026-12-20T19:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2026-11-01');
  });

  it('Jan-Apr winter instant => Nov 1 of the PREVIOUS year', () => {
    // The winter season spans the year boundary; a February instant
    // belongs to the season that began the previous November.
    const start = denverSeasonStartMs(Date.parse('2026-02-10T19:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2025-11-01');
  });
});
