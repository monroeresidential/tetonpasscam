import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStatus } from '../../src/app/useStatus';
import type { ApiStatus } from '../../src/shared/types';

function makeStatus(overrides: Partial<ApiStatus> = {}): ApiStatus {
  return {
    status: 'open',
    isStale: false,
    pollerDead: false,
    lastConfirmed: null,
    conditionText: null,
    advisories: [],
    restrictions: [],
    wydotReportTime: null,
    weather: null,
    travelTimes: [],
    id33Advisory: null,
    detours: null,
    alerts: [],
    ...overrides,
  };
}

describe('useStatus', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches exactly once on mount (no mount+visibility double-fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeStatus()), { status: 200 }),
    );

    renderHook(() => useStatus());
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/status');
  });

  it('polls again after 120s and clears the interval on unmount', async () => {
    // Fake timers scoped to this test only -- @testing-library's `waitFor`
    // (used by other tests in this file) polls via a real `setTimeout` and
    // hangs forever under fake timers that are never advanced.
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeStatus()), { status: 200 }),
    );

    const { unmount } = renderHook(() => useStatus());
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    // No further calls after unmount -- interval was cleared.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('refetches on visibilitychange -> visible', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeStatus()), { status: 200 }),
    );

    renderHook(() => useStatus());
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('persists the last good payload to localStorage and returns it as initial data', async () => {
    const payload = makeStatus({ status: 'closed' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(result.current.data?.status).toBe('closed'));
    expect(JSON.parse(localStorage.getItem('last-status')!)).toEqual(payload);
  });

  it('keeps prior data and exposes an error when a later fetch fails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(makeStatus({ status: 'open' })), { status: 200 }))
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(result.current.data?.status).toBe('open'));

    // Trigger the second (failing) fetch via visibilitychange rather than
    // the 120s interval, so this test can run under real timers alongside
    // `waitFor` (fake timers are only enabled in the dedicated interval
    // test above).
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data?.status).toBe('open');
  });
});
