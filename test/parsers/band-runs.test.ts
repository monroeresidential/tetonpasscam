import { describe, expect, it } from 'vitest';

import { MIN_DISTINCT_DAYS_FOR_BAND, bandRuns, type BandPoint } from '../../src/shared/history';

function pt(hour: number, distinctDays: number | null): BandPoint {
  return { hour, p25Sec: 1700, p75Sec: 1900, distinctDays };
}

describe('bandRuns', () => {
  it('returns one run when every point qualifies', () => {
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(8, 9)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].map((p) => p.hour)).toEqual([6, 7, 8]);
  });

  it('splits around a sub-threshold hour instead of interpolating across it', () => {
    // Hour 8 is thin -- the band must stop at 7 and restart at 9, never
    // spanning 7->9 as though hour 8 were measured.
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(8, 1), pt(9, 9), pt(10, 9)]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([
      [6, 7],
      [9, 10],
    ]);
  });

  it('splits on an hour GAP even when both sides qualify', () => {
    // Hours 6,7 then 11,12 -- nothing measured between. A polygon spanning
    // 7->11 would invent four hours of band.
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(11, 9), pt(12, 9)]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([
      [6, 7],
      [11, 12],
    ]);
  });

  it('treats NULL distinctDays as not qualifying', () => {
    // Rows written before migration 0005. NULL must never mean "allowed".
    expect(bandRuns([pt(6, null), pt(7, null)])).toEqual([]);
  });

  it('drops single-point runs -- a polygon needs two points', () => {
    expect(bandRuns([pt(6, 1), pt(7, 9), pt(8, 1)])).toEqual([]);
  });

  it('requires non-null p25 and p75, not just enough days', () => {
    const runs = bandRuns([
      { hour: 6, p25Sec: null, p75Sec: 1900, distinctDays: 9 },
      { hour: 7, p25Sec: 1700, p75Sec: 1900, distinctDays: 9 },
      { hour: 8, p25Sec: 1700, p75Sec: 1900, distinctDays: 9 },
    ]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([[7, 8]]);
  });

  it('gates exactly at the threshold', () => {
    const at = MIN_DISTINCT_DAYS_FOR_BAND;
    expect(bandRuns([pt(6, at), pt(7, at)])).toHaveLength(1);
    expect(bandRuns([pt(6, at - 1), pt(7, at - 1)])).toEqual([]);
  });
});
