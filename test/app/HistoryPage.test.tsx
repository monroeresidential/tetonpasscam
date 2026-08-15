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
