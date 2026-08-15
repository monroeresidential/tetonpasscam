import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HistoryPage from '../../src/app/HistoryPage';

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
