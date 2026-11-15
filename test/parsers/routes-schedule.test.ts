import { describe, expect, it } from 'vitest';
import {
  isRouteDue,
  routeCadenceMin,
  travelTimeFreshnessMs,
} from '../../src/worker/poller/routes-schedule';

const MIN_MS = 60_000;

// July 2026 is MDT (UTC-6); January 2026 is MST (UTC-7). Both helpers take a
// Denver wall-clock time and return the UTC instant, by hand rather than via
// src/worker/tz.ts, so the expectations do not lean on the code under test.
// 2026-07-15 and 2026-01-14 are Wednesdays; 2026-07-18 is a Saturday and
// 2026-07-19 a Sunday.
const mdt = (day: number, hour: number, minute = 0, second = 0) =>
  Date.UTC(2026, 6, day, hour + 6, minute, second);
const mst = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, day, hour + 7, minute);

const WED = 15;
const SAT = 18;
const SUN = 19;

describe('routeCadenceMin — weekdays', () => {
  it.each([
    // hour, minute, eastbound (to Jackson), westbound (to Idaho)
    [4, 50, null, null],
    [5, 0, 60, 60],
    [5, 50, 60, 60],
    [6, 0, 30, 30],
    [6, 50, 30, 30],
    [7, 0, 10, 30], // morning rush: only the Jackson-bound side speeds up
    [9, 50, 10, 30],
    [10, 0, 30, 30],
    [15, 50, 30, 30],
    [16, 0, 30, 10], // evening rush: only the Idaho-bound side speeds up
    [18, 50, 30, 10],
    [19, 0, 60, 60],
    [21, 50, 60, 60],
    [22, 0, null, null],
    [23, 30, null, null],
    [0, 30, null, null],
  ])('%i:%i Denver ⇒ eastbound %s, westbound %s', (hour, minute, eb, wb) => {
    expect(routeCadenceMin(mdt(WED, hour, minute), 'eb')).toBe(eb);
    expect(routeCadenceMin(mdt(WED, hour, minute), 'wb')).toBe(wb);
  });

  it('follows Denver wall-clock time in winter (MST), not a fixed UTC offset', () => {
    // 07:00 MST is 14:00 UTC; under a hard-coded UTC-6 this would read as
    // 08:00 (still rush), so the discriminating instants are the edges.
    expect(routeCadenceMin(mst(14, 7, 0), 'eb')).toBe(10);
    expect(routeCadenceMin(mst(14, 6, 50), 'eb')).toBe(30);
    expect(routeCadenceMin(mst(14, 21, 50), 'wb')).toBe(60);
    expect(routeCadenceMin(mst(14, 22, 0), 'wb')).toBeNull();
  });
});

describe('routeCadenceMin — weekends', () => {
  it.each([
    [4, 50, null],
    [5, 0, 60],
    [8, 50, 60],
    [9, 0, 30],
    [17, 50, 30],
    [18, 0, 60],
    [21, 50, 60],
    [22, 0, null],
  ])('%i:%i Denver ⇒ %s for both directions', (hour, minute, cadence) => {
    for (const day of [SAT, SUN]) {
      expect(routeCadenceMin(mdt(day, hour, minute), 'eb')).toBe(cadence);
      expect(routeCadenceMin(mdt(day, hour, minute), 'wb')).toBe(cadence);
    }
  });

  it('has no rush-hour speed-up: 8 AM Saturday is hourly where 8 AM Wednesday is every 10 minutes', () => {
    expect(routeCadenceMin(mdt(SAT, 8, 0), 'eb')).toBe(60);
    expect(routeCadenceMin(mdt(WED, 8, 0), 'eb')).toBe(10);
  });
});

describe('isRouteDue', () => {
  it('polls only the rush direction on a 10-minute tick inside the rush', () => {
    expect(isRouteDue(mdt(WED, 7, 10), 'eb')).toBe(true);
    expect(isRouteDue(mdt(WED, 7, 10), 'wb')).toBe(false);
    expect(isRouteDue(mdt(WED, 16, 40), 'wb')).toBe(true);
    expect(isRouteDue(mdt(WED, 16, 40), 'eb')).toBe(false);
  });

  it('polls both directions on the half hour during the day', () => {
    expect(isRouteDue(mdt(WED, 7, 30), 'eb')).toBe(true);
    expect(isRouteDue(mdt(WED, 7, 30), 'wb')).toBe(true);
    expect(isRouteDue(mdt(WED, 12, 0), 'eb')).toBe(true);
    expect(isRouteDue(mdt(WED, 12, 10), 'eb')).toBe(false);
    expect(isRouteDue(mdt(WED, 12, 20), 'wb')).toBe(false);
  });

  it('polls only on the hour in the hourly bands', () => {
    expect(isRouteDue(mdt(WED, 5, 0), 'eb')).toBe(true);
    expect(isRouteDue(mdt(WED, 5, 30), 'eb')).toBe(false);
    expect(isRouteDue(mdt(WED, 21, 0), 'wb')).toBe(true);
    expect(isRouteDue(mdt(WED, 21, 30), 'wb')).toBe(false);
    expect(isRouteDue(mdt(SAT, 8, 0), 'eb')).toBe(true);
    expect(isRouteDue(mdt(SAT, 8, 30), 'eb')).toBe(false);
  });

  it('never polls overnight', () => {
    expect(isRouteDue(mdt(WED, 22, 0), 'eb')).toBe(false);
    expect(isRouteDue(mdt(WED, 23, 0), 'wb')).toBe(false);
    expect(isRouteDue(mdt(WED, 3, 0), 'eb')).toBe(false);
    expect(isRouteDue(mdt(WED, 4, 50), 'wb')).toBe(false);
  });

  it('treats a cron that fires a few seconds late as the tick it belongs to', () => {
    // Real cycles stamp e.g. hh:50:24, not hh:50:00.
    expect(isRouteDue(mdt(WED, 12, 0, 24), 'eb')).toBe(true);
    expect(isRouteDue(mdt(WED, 12, 10, 24), 'eb')).toBe(false);
    expect(isRouteDue(mdt(WED, 5, 0, 59), 'wb')).toBe(true);
  });
});

// The budget this schedule exists to meet. Google bills each traffic-aware
// call at $0.01 after 5,000 free per month, so $100 buys 15,000 calls. Each
// direction has 6 routes. Counted by walking every 10-minute cron tick rather
// than by multiplying the table's own numbers back together.
describe('Google Routes call volume', () => {
  const ROUTES_PER_DIRECTION = 6;

  function callsBetween(startMs: number, endMs: number): number {
    let calls = 0;
    for (let ms = startMs; ms < endMs; ms += 10 * MIN_MS) {
      if (isRouteDue(ms, 'eb')) calls += ROUTES_PER_DIRECTION;
      if (isRouteDue(ms, 'wb')) calls += ROUTES_PER_DIRECTION;
    }
    return calls;
  }

  it('a weekday makes 504 calls', () => {
    expect(callsBetween(mdt(WED, 0), mdt(WED + 1, 0))).toBe(504);
  });

  it('a weekend day makes 312 calls', () => {
    expect(callsBetween(mdt(SAT, 0), mdt(SAT + 1, 0))).toBe(312);
  });

  it('the most expensive kind of month (31 days, 23 weekdays) stays under 15,000 calls', () => {
    // July 2026: Wed 1st to Fri 31st, 23 weekdays and 8 weekend days.
    const calls = callsBetween(mdt(1, 0), mdt(32, 0));
    expect(calls).toBe(23 * 504 + 8 * 312); // 14,088
    expect(calls).toBeLessThanOrEqual(15_000);
  });
});

describe('travelTimeFreshnessMs', () => {
  it('a rush-hour reading goes stale after 30 minutes', () => {
    expect(travelTimeFreshnessMs(mdt(WED, 8, 0), 'eb')).toBe(30 * MIN_MS);
  });

  it('a half-hourly reading stays fresh until the next one is 10 minutes overdue', () => {
    expect(travelTimeFreshnessMs(mdt(WED, 12, 0), 'eb')).toBe(40 * MIN_MS);
    // Same instant, other direction is in a different band.
    expect(travelTimeFreshnessMs(mdt(WED, 8, 0), 'wb')).toBe(40 * MIN_MS);
  });

  it('an hourly reading stays fresh until the next one is 10 minutes overdue', () => {
    expect(travelTimeFreshnessMs(mdt(WED, 5, 0), 'eb')).toBe(70 * MIN_MS);
    expect(travelTimeFreshnessMs(mdt(SAT, 20, 0), 'wb')).toBe(70 * MIN_MS);
  });

  it('a reading captured outside the schedule gets the 30-minute floor', () => {
    // e.g. rows written before this schedule existed, when polling ran to 23:00.
    expect(travelTimeFreshnessMs(mdt(WED, 22, 50), 'eb')).toBe(30 * MIN_MS);
  });
});
