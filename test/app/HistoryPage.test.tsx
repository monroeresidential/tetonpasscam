import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HistoryPage from '../../src/app/HistoryPage';
import type { WeatherHistoryResult } from '../../src/shared/types';

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).startsWith('/api/status')
          ? { travelTimes: [{ slug: 'victor-jackson-eb', name: 'Victor → Jackson' }] }
          : {
              route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
              typicals: [],
              today: [],
              summary: { worstDays: null, seasonMedians: null, closureDays: null },
            },
    })),
  );
}

/** Same as `stubApi`, but also answers `/api/weather-history` -- used by the
 *  temp-chart tests below, which need control over that response's typicals
 *  and today rows. `/api/history` itself is stubbed empty since these tests
 *  only care about the temp card, not the drive-time one. */
function stubApiWithWeather(weather: WeatherHistoryResult) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      return {
        ok: true,
        json: async () => {
          if (u.startsWith('/api/status')) {
            return { travelTimes: [{ slug: 'victor-jackson-eb', name: 'Victor → Jackson' }] };
          }
          if (u.startsWith('/api/weather-history')) {
            return weather;
          }
          return {
            route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
            typicals: [],
            today: [],
            summary: { worstDays: null, seasonMedians: null, closureDays: null },
          };
        },
      };
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HistoryPage subtitle', () => {
  it('says "summer Saturday" in August', async () => {
    // shouldAdvanceTime is required, not optional: waitFor polls on timers,
    // so plain useFakeTimers() freezes it and the test hangs to timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, 12:00 MDT
    stubApi();
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/summer Saturday/)).toBeTruthy());
  });

  it('says "winter Wednesday" in January', async () => {
    // shouldAdvanceTime is required, not optional: waitFor polls on timers,
    // so plain useFakeTimers() freezes it and the test hangs to timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-14T19:00:00.000Z')); // Wed, 12:00 MST
    stubApi();
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/winter Wednesday/)).toBeTruthy());
  });
});

describe('HistoryPage chart filtering (C1)', () => {
  it('plots only the weekday-class/season population matching now, not every bucket', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, 12:00 MDT -> weekend/summer
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          String(url).startsWith('/api/status')
            ? { travelTimes: [{ slug: 'victor-jackson-eb', name: 'Victor → Jackson' }] }
            : {
                route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
                typicals: [
                  // Matching population: weekend/summer, two hours.
                  {
                    weekdayClass: 'weekend',
                    season: 'summer',
                    hour: 7,
                    medianSec: 600,
                    p25Sec: null,
                    p75Sec: null,
                    sampleCount: null,
                    distinctDays: null,
                  },
                  {
                    weekdayClass: 'weekend',
                    season: 'summer',
                    hour: 8,
                    medianSec: 650,
                    p25Sec: null,
                    p75Sec: null,
                    sampleCount: null,
                    distinctDays: null,
                  },
                  // Same hour, wrong weekday-class -- must NOT plot alongside 7.
                  {
                    weekdayClass: 'weekday',
                    season: 'summer',
                    hour: 7,
                    medianSec: 900,
                    p25Sec: null,
                    p75Sec: null,
                    sampleCount: null,
                    distinctDays: null,
                  },
                  // Same hour, wrong season -- must NOT plot alongside 7.
                  {
                    weekdayClass: 'weekend',
                    season: 'winter',
                    hour: 7,
                    medianSec: 1200,
                    p25Sec: null,
                    p75Sec: null,
                    sampleCount: null,
                    distinctDays: null,
                  },
                ],
                today: [],
                summary: { worstDays: null, seasonMedians: null, closureDays: null },
              },
      })),
    );
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByTestId('median')).toBeInTheDocument());
    const points = screen.getByTestId('median').getAttribute('points')?.trim().split(' ');
    expect(points).toHaveLength(2); // only the weekend/summer hour-7 and hour-8 points
  });
});

describe('HistoryPage temp chart', () => {
  it('plots air and surface temp for the current population only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, summer
    stubApiWithWeather({
      typicals: [
        // Matching population (weekend/summer) -- these plot.
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 55, p25: 50, p75: 60, sampleCount: 30, distinctDays: 9 },
        { metric: 'surface_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 70, p25: 65, p75: 75, sampleCount: 30, distinctDays: 9 },
        { metric: 'surface_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 75, p25: 70, p75: 80, sampleCount: 30, distinctDays: 9 },
        // Wrong population -- must NOT plot. Same failure mode as the /history
        // Critical bug: two populations at one x-coordinate.
        { metric: 'air_f', weekdayClass: 'weekday', season: 'summer', hour: 8, median: 20, p25: 15, p75: 25, sampleCount: 30, distinctDays: 9 },
        { metric: 'air_f', weekdayClass: 'weekend', season: 'winter', hour: 8, median: 10, p25: 5, p75: 15, sampleCount: 30, distinctDays: 9 },
      ],
      today: [],
    });

    render(<HistoryPage />);
    const card = await screen.findByTestId('temp-card');
    const primary = within(card).getByTestId('median');
    // Two hours plotted, not four -- the weekday and winter rows must be
    // filtered out, not drawn at the same x-coordinates as the weekend/summer
    // ones. This is the same failure the /history Critical bug produced.
    expect((primary.getAttribute('points') ?? '').trim().split(' ')).toHaveLength(2);
    expect(within(card).getByTestId('median-secondary')).toBeTruthy();
  });

  it('switches the temp chart to Celsius when the unit toggle is used', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z'));
    stubApiWithWeather({
      typicals: [
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
      ],
      today: [{ capturedAt: '2026-08-15T15:00:00.000Z', airF: 50, surfaceF: 70 }],
    });

    render(<HistoryPage />);
    expect(await screen.findByText(/now · 50°F/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '°C' }));
    expect(await screen.findByText(/now · 10°C/)).toBeTruthy();
  });
});
