// REAL PAYLOAD (captured 2026-08-16 from
// api.weather.gov/gridpoints/RIW/35,140/forecast/hourly): 156 hourly
// periods. See test/fixtures/README.md for provenance.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  categorize,
  parseWindMph,
  rollupDaily,
  takeHours,
  STORED_HOURS,
  type HourlyPeriod,
} from '../../src/worker/poller/nws-forecast';
import { toIconPath } from '../../src/worker/api/wx-icon';

const live = JSON.parse(readFileSync('test/fixtures/nws-hourly.json', 'utf8'))
  .properties.periods as HourlyPeriod[];

/** Minimal period builder -- every field the rollup reads, defaulted to
 *  something inert so each test only states the field it is about. */
function period(over: Partial<HourlyPeriod> & { startTime: string }): HourlyPeriod {
  return {
    isDaytime: true,
    temperature: 50,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: null },
    windSpeed: null,
    icon: null,
    shortForecast: 'Sunny',
    ...over,
  };
}

/** `count` consecutive hourly periods starting at hour `startHour` on `date`
 *  (Denver local, -06:00 in August). */
function hours(date: string, startHour: number, count: number, over: Partial<HourlyPeriod> = {}) {
  return Array.from({ length: count }, (_, i) =>
    period({
      startTime: `${date}T${String(startHour + i).padStart(2, '0')}:00:00-06:00`,
      ...over,
    }),
  );
}

describe('categorize', () => {
  it('maps the live fixture vocabulary to the eight categories', () => {
    expect(categorize('Sunny')).toBe('clear');
    expect(categorize('Mostly Clear')).toBe('clear');
    expect(categorize('Partly Cloudy')).toBe('partly-cloudy');
    expect(categorize('Mostly Cloudy')).toBe('cloudy');
    expect(categorize('Slight Chance Rain Showers')).toBe('rain');
    expect(categorize('Chance Showers And Thunderstorms')).toBe('thunderstorm');
  });

  it('classifies winter vocabulary, and rain+snow as mixed not snow', () => {
    expect(categorize('Chance Snow Showers')).toBe('snow');
    expect(categorize('Blowing Snow')).toBe('snow');
    expect(categorize('Freezing Rain')).toBe('snow');
    expect(categorize('Rain And Snow')).toBe('mixed');
    expect(categorize('Patchy Fog')).toBe('fog');
  });

  it('prefers thunderstorm over the precipitation it arrives with', () => {
    expect(categorize('Rain Showers And Thunderstorms')).toBe('thunderstorm');
  });

  it('falls back to cloudy for unrecognized text and for null', () => {
    expect(categorize('Breezy')).toBe('cloudy');
    expect(categorize(null)).toBe('cloudy');
  });

  it('classifies showers without explicit rain as rain', () => {
    expect(categorize('Chance Showers')).toBe('rain');
    expect(categorize('Showers Likely')).toBe('rain');
  });
});

describe('parseWindMph', () => {
  it('parses a single speed and takes the top of a range', () => {
    expect(parseWindMph('6 mph')).toBe(6);
    expect(parseWindMph('5 to 10 mph')).toBe(10);
  });

  it('returns null for missing or unparseable input', () => {
    expect(parseWindMph(null)).toBeNull();
    expect(parseWindMph('calm')).toBeNull();
  });
});

describe('rollupDaily', () => {
  it('buckets on the Denver calendar day, not the UTC day', () => {
    // 23:00-06:00 is 05:00Z the NEXT day -- a UTC-day bucketer puts these
    // two hours on different dates and shifts the whole strip.
    const days = rollupDaily([
      ...hours('2026-08-16', 12, 12), // through 23:00
      ...hours('2026-08-17', 0, 12),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-08-16', '2026-08-17']);
  });

  it('picks the category from DAYTIME periods only', () => {
    const days = rollupDaily([
      ...hours('2026-08-16', 6, 12, { isDaytime: true, shortForecast: 'Sunny' }),
      ...hours('2026-08-16', 18, 6, { isDaytime: false, shortForecast: 'Snow' }),
    ]);
    expect(days[0].category).toBe('clear');
  });

  it('breaks a daytime tie toward the more severe category', () => {
    const days = rollupDaily([
      ...hours('2026-08-16', 6, 6, { shortForecast: 'Sunny' }),
      ...hours('2026-08-16', 12, 6, { shortForecast: 'Snow' }),
    ]);
    expect(days[0].category).toBe('snow');
  });

  it('takes high/low from the FULL day, not just daylight', () => {
    const days = rollupDaily([
      ...hours('2026-08-16', 6, 12, { isDaytime: true, temperature: 60 }),
      ...hours('2026-08-16', 18, 6, { isDaytime: false, temperature: 18 }),
    ]);
    expect(days[0].highF).toBe(60);
    expect(days[0].lowF).toBe(18);
  });

  it('reports precip as the daily max, and null when every hour is null', () => {
    const withPop = rollupDaily(
      hours('2026-08-16', 0, 24).map((p, i) => ({
        ...p,
        probabilityOfPrecipitation: { value: i === 5 ? 70 : 10 },
      })),
    );
    expect(withPop[0].precipPct).toBe(70);

    const noPop = rollupDaily(hours('2026-08-16', 0, 24));
    expect(noPop[0].precipPct).toBeNull();
  });

  it('drops a short TRAILING day but always keeps a short today', () => {
    const days = rollupDaily([
      ...hours('2026-08-16', 20, 4), // partial today -- kept
      ...hours('2026-08-17', 0, 24),
      ...hours('2026-08-18', 0, 3), // partial trailing -- dropped
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-08-16', '2026-08-17']);
  });

  it('categorizes an all-night partial day from its night periods', () => {
    // A poll at 8 PM leaves today with no daytime periods at all; falling
    // back to all periods beats emitting a default.
    const days = rollupDaily(
      hours('2026-08-16', 20, 4, { isDaytime: false, shortForecast: 'Snow' }),
    );
    expect(days[0].category).toBe('snow');
  });

  it('carries the icon and text of a period matching the winning category', () => {
    const days = rollupDaily([
      ...hours('2026-08-16', 6, 6, { shortForecast: 'Sunny', icon: 'https://x/day/few' }),
      ...hours('2026-08-16', 12, 12, {
        shortForecast: 'Snow',
        icon: 'https://x/day/snow',
      }),
    ]);
    expect(days[0].category).toBe('snow');
    expect(days[0].iconUrl).toBe('https://x/day/snow');
    expect(days[0].shortForecast).toBe('Snow');
  });

  it('converts a Celsius period to Fahrenheit', () => {
    const days = rollupDaily(hours('2026-08-16', 0, 24, { temperature: 0, temperatureUnit: 'C' }));
    expect(days[0].highF).toBe(32);
  });

  it('produces at least 6 usable days from the live 156-period fixture', () => {
    const days = rollupDaily(live);
    expect(days.length).toBeGreaterThanOrEqual(6);
    expect(days[0].date).toBe('2026-08-16');
    for (const d of days) {
      expect(d.highF).not.toBeNull();
      expect(d.lowF).not.toBeNull();
      expect(d.highF!).toBeGreaterThanOrEqual(d.lowF!);
      expect(d.iconUrl).toContain('api.weather.gov/icons/');
    }
  });

  it('returns an empty array for no periods', () => {
    expect(rollupDaily([])).toEqual([]);
  });

  it('produces an iconUrl for every live day that survives the proxy\'s toIconPath allowlist', () => {
    // The rollup and the proxy are otherwise tested against hand-picked
    // strings in separate files -- nothing previously asserted that the
    // icons the REAL fixture actually produces survive `toIconPath`'s
    // regex. This is a guard, not a bug fix: verified manually that all 24
    // distinct icon URLs in the live fixture pass today. Its job is to fail
    // this test instead of silently blanking the home-screen forecast strip
    // the day NWS's icon vocabulary changes.
    for (const d of rollupDaily(live)) {
      expect(toIconPath(d.iconUrl)).not.toBeNull();
    }
  });
});

describe('takeHours', () => {
  it('caps at STORED_HOURS and preserves upstream order', () => {
    const out = takeHours(live);
    expect(out).toHaveLength(STORED_HOURS);
    expect(out[0].startTime).toBe(live[0].startTime);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThan(out[i - 1].startMs);
    }
  });

  it('parses startMs as a true instant, not a string sort key', () => {
    // The fall-back night: 01:30-06:00 is 07:30Z, EARLIER than 01:00-07:00
    // (08:00Z), even though it sorts after it as a string. startMs must
    // reflect the instant.
    const out = takeHours([
      period({ startTime: '2026-11-01T01:30:00-06:00' }),
      period({ startTime: '2026-11-01T01:00:00-07:00' }),
    ]);
    expect(out[0].startMs).toBe(Date.parse('2026-11-01T01:30:00-06:00'));
    expect(out[1].startMs).toBe(Date.parse('2026-11-01T01:00:00-07:00'));
    expect(out[0].startMs).toBeLessThan(out[1].startMs);
  });

  it('carries isDaytime through per period', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', isDaytime: true }),
      period({ startTime: '2026-08-16T22:00:00-06:00', isDaytime: false }),
    ]);
    expect(out[0].isDaytime).toBe(true);
    expect(out[1].isDaytime).toBe(false);
  });

  it('reuses categorize, so an hour agrees with the daily rollup vocabulary', () => {
    const out = takeHours([period({ startTime: '2026-08-16T14:00:00-06:00', shortForecast: 'Chance Snow Showers' })]);
    expect(out[0].category).toBe('snow');
  });

  it('keeps a null precip as null, never 0', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', probabilityOfPrecipitation: { value: null } }),
    ]);
    expect(out[0].precipPct).toBeNull();
  });

  it('normalizes a Celsius period to Fahrenheit', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', temperature: 0, temperatureUnit: 'C' }),
    ]);
    expect(out[0].tempF).toBe(32);
  });

  it('drops a period whose startTime will not parse', () => {
    const out = takeHours([
      period({ startTime: 'not-a-time' }),
      period({ startTime: '2026-08-16T14:00:00-06:00' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].startTime).toBe('2026-08-16T14:00:00-06:00');
  });

  it('returns an empty array for no periods', () => {
    expect(takeHours([])).toEqual([]);
  });
});
