import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HomeHistoryCard from '../../src/app/components/HomeHistoryCard';

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
          summary: { worstDays: null, seasonMedians: null, closureDays: null },
        }),
      })),
    );
    render(<HomeHistoryCard slug="victor-jackson-eb" />);
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/history'));
  });

  it("clears the previous route's chart immediately on a slug change, instead of leaving it on screen under the new route", async () => {
    const routeAResult = {
      route: { slug: 'route-a', name: 'A' },
      typicals: [{ hour: 8, medianSec: 600, p25Sec: 500, p75Sec: 700, distinctDays: 10 }],
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

    const { rerender } = render(<HomeHistoryCard slug="route-a" />);
    await waitFor(() => expect(screen.getByTestId('median')).toBeInTheDocument());

    rerender(<HomeHistoryCard slug="route-b" />);

    // route-a's chart must be gone the moment the slug changes, not left
    // showing under route-b's card until route-b's (still-pending) fetch
    // resolves.
    expect(screen.queryByTestId('median')).not.toBeInTheDocument();
    expect(screen.getByText('No history for this route yet.')).toBeInTheDocument();

    resolveRouteB();
    await waitFor(() => expect(screen.getByText('No history for this route yet.')).toBeInTheDocument());
  });
});
