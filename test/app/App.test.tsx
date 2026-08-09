import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/app/App';
import type { ApiStatus } from '../../src/shared/types';

function makeStatus(overrides: Partial<ApiStatus> = {}): ApiStatus {
  return {
    status: 'open',
    isStale: false,
    pollerDead: false,
    lastConfirmed: { status: 'open', at: '2026-08-09T17:00:00.000Z' },
    conditionText: null,
    advisories: [],
    restrictions: [],
    wydotReportTime: '2026-08-09T17:00:00.000Z',
    weather: null,
    travelTimes: [],
    id33Advisory: null,
    detours: null,
    alerts: [],
    ...overrides,
  };
}

function statusFetchCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]) => input === '/api/status').length;
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refetches /api/status immediately after a successful report submission, without waiting for the next poll', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url === '/api/status') {
        return new Response(JSON.stringify(makeStatus()), { status: 200 });
      }
      if (url === '/api/alerts') {
        return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as ReturnType<typeof vi.fn>;

    const user = userEvent.setup();
    render(<App />);

    // Initial mount fetch has resolved once the banner renders.
    await screen.findByText('OPEN');
    expect(statusFetchCount(fetchMock)).toBe(1);

    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(statusFetchCount(fetchMock)).toBe(2));
  });

  describe('offline banner (Task 16)', () => {
    function setOnline(value: boolean) {
      Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
    }

    afterEach(() => {
      setOnline(true);
    });

    it('shows a prominent OFFLINE banner with the last-known time and keeps showing the cached status', async () => {
      const cached = makeStatus({ status: 'closed' });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date(Date.now() - 5 * 60_000).toISOString());
      setOnline(false);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

      render(<App />);

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(/OFFLINE/);
      expect(banner).toHaveTextContent(/showing last known status from/i);
      // Cached status still renders -- the cache is only 5 minutes old,
      // well under the 2h "force unknown" cutoff.
      expect(await screen.findByText('CLOSED')).toBeInTheDocument();
    });

    it('forces the UNKNOWN presentation instead of a stale OPEN when the cached payload is more than 2h old', async () => {
      const staleOpen = makeStatus({ status: 'open', pollerDead: false });
      localStorage.setItem('last-status', JSON.stringify(staleOpen));
      const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      localStorage.setItem('last-status-at', threeHoursAgo);
      setOnline(false);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

      render(<App />);

      await screen.findByRole('alert');
      // Never present a >2h-old cached "open" as a current OPEN status.
      expect(screen.queryByText('OPEN')).not.toBeInTheDocument();
      expect(await screen.findByText('UNKNOWN')).toBeInTheDocument();
    });
  });
});
