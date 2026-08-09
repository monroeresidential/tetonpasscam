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
});
