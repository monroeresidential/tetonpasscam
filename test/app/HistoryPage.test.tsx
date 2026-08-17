import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HistoryPage from '../../src/app/HistoryPage';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';
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
    // Matched against the drive-time subtitle specifically ("Travel time...")
    // -- the temp card's subtitle (added for I1) names the same season/weekday
    // population and would otherwise make this match ambiguous.
    await waitFor(() => expect(screen.getByText(/Travel time.*summer Saturday/)).toBeTruthy());
  });

  it('says "winter Wednesday" in January', async () => {
    // shouldAdvanceTime is required, not optional: waitFor polls on timers,
    // so plain useFakeTimers() freezes it and the test hangs to timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-14T19:00:00.000Z')); // Wed, 12:00 MST
    stubApi();
    render(<HistoryPage />);
    // Matched against the drive-time subtitle specifically -- see the comment
    // in the "summer Saturday" test above.
    await waitFor(() => expect(screen.getByText(/Travel time.*winter Wednesday/)).toBeTruthy());
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

  it('withholds the band but still draws the median when the temp chart has sub-threshold distinctDays', async () => {
    // I3 regression: if tempPoints ever mapped sampleCount into distinctDays
    // instead of the real distinctDays column, every fixture in this suite
    // (5 or 9) would clear the threshold and this gate would never be
    // exercised. distinctDays here is deliberately BELOW
    // MIN_DISTINCT_DAYS_FOR_BAND, derived from the constant rather than
    // hardcoded, so the test tracks it if it changes.
    const thin = MIN_DISTINCT_DAYS_FOR_BAND - 1;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, summer
    stubApiWithWeather({
      typicals: [
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: thin },
        { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 55, p25: 50, p75: 60, sampleCount: 30, distinctDays: thin },
      ],
      today: [],
    });

    render(<HistoryPage />);
    const tempCard = await screen.findByTestId('temp-card');
    await waitFor(() => expect(within(tempCard).getByTestId('median')).toBeTruthy());
    expect(within(tempCard).queryByTestId('band')).toBeNull();
    expect(within(tempCard).getByTestId('median')).toBeTruthy();
  });
});

/**
 * Stubs `/api/status` with several routes split across both eb/wb directions
 * (so the select has real choices and the WY/ID toggle has somewhere to
 * reset to), and `/api/history` + `/api/weather-history` with typicals in
 * the SAME weekend/summer population `denverNow()` reports for the pinned
 * time below -- an empty/mismatched population makes both charts render
 * their "no history" message instead of a plotted SVG, and the axis-title
 * assertions below would find nothing to match against.
 */
function renderHistory() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, noon MDT -> weekend/summer

  // MemoryStorage (test/app/setup.ts) is a module-level singleton shared by
  // every test in this file, not reset between them -- the Celsius test
  // above leaves 'C' behind, which would silently flip the
  // "Temperature (°F)" assertion below.
  localStorage.setItem('temp-unit', 'F');

  const EB_ROUTES = [
    { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
    { slug: 'driggs-jackson-eb', name: 'Driggs → Jackson' },
    { slug: 'victor-airport-eb', name: 'Victor → Airport' },
  ];
  const WB_ROUTES = [
    { slug: 'jackson-victor-wb', name: 'Jackson → Victor' },
    { slug: 'jackson-driggs-wb', name: 'Jackson → Driggs' },
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('/api/status')) {
        return { ok: true, json: async () => ({ travelTimes: [...EB_ROUTES, ...WB_ROUTES] }) };
      }
      if (u.startsWith('/api/weather-history')) {
        return {
          ok: true,
          json: async () => ({
            typicals: [
              {
                metric: 'air_f',
                weekdayClass: 'weekend',
                season: 'summer',
                hour: 8,
                median: 50,
                p25: 45,
                p75: 55,
                sampleCount: 30,
                distinctDays: 9,
              },
              {
                metric: 'air_f',
                weekdayClass: 'weekend',
                season: 'summer',
                hour: 9,
                median: 55,
                p25: 50,
                p75: 60,
                sampleCount: 30,
                distinctDays: 9,
              },
            ],
            today: [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
          typicals: [
            {
              weekdayClass: 'weekend',
              season: 'summer',
              hour: 7,
              medianSec: 600,
              p25Sec: 500,
              p75Sec: 700,
              sampleCount: 30,
              distinctDays: 9,
            },
            {
              weekdayClass: 'weekend',
              season: 'summer',
              hour: 8,
              medianSec: 650,
              p25Sec: 550,
              p75Sec: 750,
              sampleCount: 30,
              distinctDays: 9,
            },
          ],
          today: [],
          summary: { worstDays: null, seasonMedians: null, closureDays: null },
        }),
      };
    }),
  );

  return render(<HistoryPage />);
}

describe('HistoryPage controls (native select + segmented, tighter type scale)', () => {
  it('picks the route with a select rather than pills, at every width', () => {
    renderHistory();
    expect(screen.getByRole('combobox', { name: /route/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it("resets the selection to the side's first route when the side flips", async () => {
    renderHistory();
    const select = screen.getByRole('combobox', { name: /route/i });
    // /api/status resolves asynchronously -- the select has no options on
    // the first render, so selecting one has to wait for that fetch first.
    const airport = await screen.findByRole('option', { name: /Airport/ });
    await userEvent.selectOptions(select, airport);
    await userEvent.click(screen.getByRole('button', { name: '→ ID' }));
    // Side switch re-populates the options; selection returns to the first.
    expect((select as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('passes unit-aware axis titles to both charts', async () => {
    renderHistory();
    expect(await screen.findByText('Travel time (min)')).toBeInTheDocument();
    expect(await screen.findByText('Temperature (°F)')).toBeInTheDocument();
  });

  it('gives both charts a descriptive accessible name (R4)', async () => {
    renderHistory();
    // Role+name, not a text query: TypicalChart renders role="img" with
    // ariaLabel as the accessible name, so this is the query shape that
    // actually exercises the aria-label wiring rather than any visible
    // caption text that happens to say something similar.
    expect(await screen.findByRole('img', { name: /Travel time by hour of day/ })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Summit temperature by hour of day/ })).toBeInTheDocument();
  });

  it('drops the removed copy', async () => {
    renderHistory();
    // Waiting for the chart to render first rules out a false pass -- an
    // empty/loading chart has neither string either.
    await screen.findByText('Travel time (min)');
    // Scoped to the two specific removed strings, not a page-wide
    // /typical range/i query: the chart legend's "Typical range" band
    // swatch (ChartLegend, unchanged by this task and present in the
    // prototype's own legend row) legitimately keeps that wording, and a
    // broader match would flag it as a false regression.
    expect(screen.queryByText(/middle half of recorded days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/today's air reading against/i)).not.toBeInTheDocument();
  });

  it('shortens the back link so it cannot wrap', () => {
    renderHistory();
    expect(screen.getByRole('link', { name: '← Live' })).toBeInTheDocument();
  });
});
