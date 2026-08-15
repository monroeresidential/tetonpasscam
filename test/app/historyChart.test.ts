import { describe, expect, it } from 'vitest';

import { denverFractionalHourOf, denverNow, typicalsToChartPoints } from '../../src/app/historyChart';
import type { HistoryTypical } from '../../src/shared/types';

function typical(overrides: Partial<HistoryTypical> & Pick<HistoryTypical, 'weekdayClass' | 'season' | 'hour'>): HistoryTypical {
  return {
    medianSec: null,
    p25Sec: null,
    p75Sec: null,
    sampleCount: null,
    distinctDays: null,
    ...overrides,
  };
}

describe('typicalsToChartPoints (C1)', () => {
  it('keeps only the bucket matching the given weekdayClass/season, dropping the other three populations', () => {
    const typicals: HistoryTypical[] = [
      typical({ weekdayClass: 'weekday', season: 'summer', hour: 7, medianSec: 600, p25Sec: 500, p75Sec: 700, distinctDays: 5 }),
      typical({ weekdayClass: 'weekend', season: 'summer', hour: 7, medianSec: 900 }),
      typical({ weekdayClass: 'weekday', season: 'winter', hour: 7, medianSec: 1200 }),
      typical({ weekdayClass: 'weekend', season: 'winter', hour: 7, medianSec: 1500 }),
      typical({ weekdayClass: 'weekday', season: 'summer', hour: 8, medianSec: 650, p25Sec: 550, p75Sec: 750, distinctDays: 5 }),
    ];

    expect(typicalsToChartPoints(typicals, 'weekday', 'summer')).toEqual([
      { hour: 7, medianSec: 600, p25Sec: 500, p75Sec: 700, distinctDays: 5 },
      { hour: 8, medianSec: 650, p25Sec: 550, p75Sec: 750, distinctDays: 5 },
    ]);
  });

  it('sorts by hour regardless of input order', () => {
    const typicals: HistoryTypical[] = [
      typical({ weekdayClass: 'weekday', season: 'summer', hour: 9, medianSec: 700 }),
      typical({ weekdayClass: 'weekday', season: 'summer', hour: 7, medianSec: 600 }),
    ];
    expect(typicalsToChartPoints(typicals, 'weekday', 'summer').map((p) => p.hour)).toEqual([7, 9]);
  });
});

describe('denverFractionalHourOf (I2)', () => {
  it('spreads a reading within an hour instead of stacking every reading at the whole hour', () => {
    // 2026-08-15T15:30:00Z is 09:30 America/Denver (MDT, UTC-6 in August).
    expect(denverFractionalHourOf('2026-08-15T15:30:00.000Z')).toBeCloseTo(9.5, 5);
  });

  it('returns the whole hour, unchanged, for an on-the-hour reading', () => {
    // 2026-08-15T15:00:00Z is 09:00 America/Denver (MDT).
    expect(denverFractionalHourOf('2026-08-15T15:00:00.000Z')).toBe(9);
  });
});

describe('denverNow', () => {
  it('derives summer for a May-Oct instant and winter otherwise', () => {
    expect(denverNow(new Date('2026-08-15T18:00:00.000Z')).season).toBe('summer');
    expect(denverNow(new Date('2026-01-14T19:00:00.000Z')).season).toBe('winter');
  });

  it('classes Saturday/Sunday as weekend', () => {
    // 2026-08-15T18:00:00Z is Saturday 12:00 MDT.
    expect(denverNow(new Date('2026-08-15T18:00:00.000Z')).weekdayClass).toBe('weekend');
    // 2026-01-14T19:00:00Z is Wednesday 12:00 MST.
    expect(denverNow(new Date('2026-01-14T19:00:00.000Z')).weekdayClass).toBe('weekday');
  });
});
