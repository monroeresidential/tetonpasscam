/**
 * How many distinct America/Denver calendar days a (route, weekday-class,
 * hour, season) bucket needs before /history will draw a p25-p75 band for
 * it. Gates on DAYS, not sample count: the poller runs every 10 minutes for
 * most of the day, so a single day contributes ~6 samples to an hour bucket
 * -- a 30-sample bucket can be just 5 days, and within-hour spread is not
 * the day-to-day spread a "typical band" claims to show.
 *
 * Consequence, accepted deliberately (see the design doc): weekend buckets
 * accrue only 2 distinct days per week, so weekend bands do not appear
 * until roughly two weeks of history. This constant is the single lever if
 * that turns out too strict.
 */
export const MIN_DISTINCT_DAYS_FOR_BAND = 4;

export interface BandPoint {
  hour: number;
  p25Sec: number | null;
  p75Sec: number | null;
  /** NULL for rows written before migration 0002 -- treated as NOT qualifying. */
  distinctDays: number | null;
}

function qualifies(p: BandPoint): boolean {
  return (
    p.p25Sec !== null &&
    p.p75Sec !== null &&
    p.distinctDays !== null &&
    p.distinctDays >= MIN_DISTINCT_DAYS_FOR_BAND
  );
}

/**
 * Split `points` (ascending by hour) into maximal runs that can be drawn as
 * one band polygon: every point qualifies AND the hours are contiguous.
 *
 * Both breaks matter. A sub-threshold hour must interrupt the band rather
 * than being spanned, and so must a missing hour -- a polygon drawn from
 * hour 7 straight to hour 11 would render four hours of band we never
 * measured. Runs shorter than two points are dropped, since a single point
 * has no polygon.
 */
export function bandRuns<T extends BandPoint>(points: T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];

  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };

  for (const p of points) {
    if (!qualifies(p)) {
      flush();
      continue;
    }
    const prev = current[current.length - 1];
    if (prev && p.hour !== prev.hour + 1) flush();
    current.push(p);
  }
  flush();

  return runs;
}
