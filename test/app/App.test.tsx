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
    generatedAt: new Date().toISOString(),
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

function mockStatusOnlyFetch(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url === '/api/status') {
      return new Response(JSON.stringify(makeStatus()), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
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
    await screen.findByText('The pass is OPEN');
    expect(statusFetchCount(fetchMock)).toBe(1);

    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '⚠ Other' }));
    await user.click(screen.getByRole('button', { name: /send report/i }));

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
      expect(await screen.findByText(/Closed — do not attempt/)).toBeInTheDocument();
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
      expect(screen.queryByText(/The pass is OPEN/)).not.toBeInTheDocument();
      expect(await screen.findByText('UNKNOWN')).toBeInTheDocument();
    });
  });

  describe('phone/desktop layout (Task 2)', () => {
    it('renders the cameras section exactly once (not duplicated by the grid restructure)', async () => {
      mockStatusOnlyFetch();
      render(<App />);
      await screen.findByText('The pass is OPEN');

      expect(screen.getAllByRole('region', { name: 'Teton Pass cameras' })).toHaveLength(1);
    });

    it('renders exactly one report-conditions trigger button (the fixed pill, in default jsdom)', async () => {
      mockStatusOnlyFetch();
      render(<App />);
      await screen.findByText('The pass is OPEN');

      expect(screen.getAllByRole('button', { name: /report conditions/i })).toHaveLength(1);
    });

    it('renders the header wordmark', async () => {
      mockStatusOnlyFetch();
      render(<App />);
      await screen.findByText('The pass is OPEN');

      expect(screen.getByText('Teton Pass Cam')).toBeInTheDocument();
    });

    it('caps the desktop content wrapper at 720px instead of leaving it unbounded', async () => {
      mockStatusOnlyFetch();
      const { container } = render(<App />);
      await screen.findByText('The pass is OPEN');

      const wrapper = container.querySelector('.mx-auto');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).toContain('lg:max-w-[720px]');
      expect(wrapper?.className).not.toContain('lg:max-w-none');
    });
  });

  describe('explainer relocation (scope addition)', () => {
    // main.tsx's #seo-shell hide/show logic lives outside App (it never
    // renders index.html's static markup -- App is only ever mounted into a
    // bare testing-library container, with no #seo-shell sibling present),
    // so this just pins that <About />'s relocated H1 is the ONE h1 a real,
    // JS-enabled visitor's DOM ends up with -- no duplicate heading from
    // some other section.
    it('renders exactly one h1 (the relocated About explainer, between Sponsor and Footer)', async () => {
      mockStatusOnlyFetch();
      render(<App />);
      await screen.findByText('The pass is OPEN');

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Teton Pass — live cams & conditions');
    });
  });
});
