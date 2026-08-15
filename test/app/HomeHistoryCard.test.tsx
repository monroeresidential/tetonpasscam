import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HomeHistoryCard from '../../src/app/components/HomeHistoryCard';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HomeHistoryCard', () => {
  it('links to the full history page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
          typicals: [],
          today: [],
          summary: null,
        }),
      })),
    );
    render(<HomeHistoryCard slug="victor-jackson-eb" routeName="Victor → Jackson" />);
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/history'));
  });

  it('names the route it charts (I4)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
          typicals: [],
          today: [],
          summary: null,
        }),
      })),
    );
    render(<HomeHistoryCard slug="victor-jackson-eb" routeName="Victor → Jackson" />);
    expect(screen.getByText('Victor → Jackson')).toBeInTheDocument();
  });

  it('requests /api/history WITHOUT opting into the summary block (I3)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
        typicals: [],
        today: [],
        summary: null,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<HomeHistoryCard slug="victor-jackson-eb" routeName="Victor → Jackson" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('summary=1');
  });

  it('plots only the weekday-class/season population matching now, not every bucket (C1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, 12:00 MDT -> weekend/summer
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          route: { slug: 'r', name: 'R' },
          typicals: [
            // Matching population: weekend/summer, two hours.
            { weekdayClass: 'weekend', season: 'summer', hour: 7, medianSec: 600, p25Sec: null, p75Sec: null, sampleCount: null, distinctDays: null },
            { weekdayClass: 'weekend', season: 'summer', hour: 8, medianSec: 650, p25Sec: null, p75Sec: null, sampleCount: null, distinctDays: null },
            // Same hour, wrong weekday-class -- must NOT plot alongside 7.
            { weekdayClass: 'weekday', season: 'summer', hour: 7, medianSec: 900, p25Sec: null, p75Sec: null, sampleCount: null, distinctDays: null },
            // Same hour, wrong season -- must NOT plot alongside 7.
            { weekdayClass: 'weekend', season: 'winter', hour: 7, medianSec: 1200, p25Sec: null, p75Sec: null, sampleCount: null, distinctDays: null },
          ],
          today: [],
          summary: null,
        }),
      })),
    );
    render(<HomeHistoryCard slug="r" routeName="R" />);
    await waitFor(() => expect(screen.getByTestId('median')).toBeInTheDocument());
    const points = screen.getByTestId('median').getAttribute('points')?.trim().split(' ');
    expect(points).toHaveLength(2); // only the weekend/summer hour-7 and hour-8 points
  });

  it("clears the previous route's chart immediately on a slug change, instead of leaving it on screen under the new route", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, 12:00 MDT -> weekend/summer
    const routeAResult = {
      route: { slug: 'route-a', name: 'A' },
      typicals: [
        { weekdayClass: 'weekend', season: 'summer', hour: 8, medianSec: 600, p25Sec: 500, p75Sec: 700, distinctDays: 10 },
      ],
      today: [],
      summary: { worstDays: null, seasonMedians: null, closureDays: null },
    };
    // route-b's fetch is held open past the rerender so the assertion right
    // after the slug change catches the state *before* new data can have
    // arrived -- proving the clear is synchronous with the slug change, not
    // just an eventual side effect of the new response landing.
    let resolveRouteB: () => void = () => {};
    const routeBGate = new Promise<void>((resolve) => {
      resolveRouteB = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('route=route-a')) {
          return { ok: true, json: async () => routeAResult };
        }
        if (url.includes('route=route-b')) {
          await routeBGate;
          return {
            ok: true,
            json: async () => ({
              route: { slug: 'route-b', name: 'B' },
              typicals: [],
              today: [],
              summary: { worstDays: null, seasonMedians: null, closureDays: null },
            }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { rerender } = render(<HomeHistoryCard slug="route-a" routeName="A" />);
    await waitFor(() => expect(screen.getByTestId('median')).toBeInTheDocument());

    rerender(<HomeHistoryCard slug="route-b" routeName="B" />);

    // route-a's chart must be gone the moment the slug changes, not left
    // showing under route-b's card until route-b's (still-pending) fetch
    // resolves.
    expect(screen.queryByTestId('median')).not.toBeInTheDocument();
    expect(screen.getByText('No history for this route yet.')).toBeInTheDocument();

    resolveRouteB();
    await waitFor(() => expect(screen.getByText('No history for this route yet.')).toBeInTheDocument());
  });
});
