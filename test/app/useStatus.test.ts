import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStatus } from '../../src/app/useStatus';
import type { ApiStatus } from '../../src/shared/types';

function makeStatus(overrides: Partial<ApiStatus> = {}): ApiStatus {
  return {
    status: 'open',
    isStale: false,
    pollerDead: false,
    generatedAt: new Date().toISOString(),
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

  it('exposes a refresh() that manually triggers another fetch (e.g. after a report submission)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeStatus()), { status: 200 }),
    );

    const { result } = renderHook(() => useStatus());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  describe('cold-start and generatedAt staleness guards (final review fix wave #2)', () => {
    it('cold start renders UNKNOWN immediately when the cached payload is >2h old and the first fetch never resolves', async () => {
      const cached = makeStatus({ status: 'open', pollerDead: false });
      localStorage.setItem('last-status', JSON.stringify(cached));
      const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      localStorage.setItem('last-status-at', threeHoursAgo);
      // A fetch that never settles -- simulates a hanging/dead connection,
      // the scenario the >2h forced-unknown check previously missed since
      // it only ran once a fetch had actually FAILED.
      vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useStatus());

      // No `waitFor`/`act` needed -- the initializer itself must already
      // apply the staleness guard, synchronously, before the pending fetch
      // has any chance to resolve or reject.
      expect(result.current.data?.pollerDead).toBe(true);
      expect(result.current.data?.status).toBe('open'); // underlying status preserved
    });

    it('a resolved-but-stale 200 (simulating a stale Service-Worker cache entry) is forced to the UNKNOWN presentation via generatedAt, even though the fetch genuinely succeeded', async () => {
      const staleGeneratedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const stalePayload = makeStatus({ status: 'open', pollerDead: false, generatedAt: staleGeneratedAt });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(stalePayload), { status: 200 }),
      );

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.data).not.toBeNull());

      // This is NOT the offline path -- the fetch resolved successfully, so
      // only the generatedAt guard (not the offline/cache-age one) can be
      // responsible for the forced presentation below.
      expect(result.current.error).toBeNull();
      expect(result.current.offline).toBe(false);
      expect(result.current.data?.pollerDead).toBe(true);
      expect(result.current.data?.status).toBe('open');
    });

    it('a resolved 200 with a recent generatedAt is NOT forced to UNKNOWN', async () => {
      const recentPayload = makeStatus({ status: 'open', pollerDead: false });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(recentPayload), { status: 200 }),
      );

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.data).not.toBeNull());

      expect(result.current.data?.pollerDead).toBe(false);
    });
  });

  describe('offline fallback (Task 16)', () => {
    function setOnline(value: boolean) {
      Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
    }

    afterEach(() => {
      setOnline(true);
    });

    it('falls back to the cached payload and reports offline when navigator.onLine is false', async () => {
      const cached = makeStatus({ status: 'closed' });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date().toISOString());
      setOnline(false);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.offline).toBe(true));

      expect(result.current.data?.status).toBe('closed');
      expect(result.current.offlineSince).toBeInstanceOf(Date);
    });

    it('marks offline when the fetch call itself rejects, even if navigator.onLine still reads true', async () => {
      const cached = makeStatus({ status: 'open' });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date().toISOString());
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.offline).toBe(true));
      expect(result.current.data?.status).toBe('open');
    });

    it('does NOT report offline for a plain non-2xx HTTP response while online', async () => {
      const cached = makeStatus({ status: 'open' });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date().toISOString());
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('server error', { status: 500 }));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
      expect(result.current.offline).toBe(false);
    });

    it('forces pollerDead (unknown presentation) when the cached payload is more than 2h old, even though the payload itself claims pollerDead: false', async () => {
      const cached = makeStatus({ status: 'open', pollerDead: false });
      localStorage.setItem('last-status', JSON.stringify(cached));
      const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      localStorage.setItem('last-status-at', threeHoursAgo);
      setOnline(false);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.offline).toBe(true));

      expect(result.current.data?.pollerDead).toBe(true);
      // Underlying status is preserved (StatusBanner reads pollerDead to
      // decide the presentation) -- only the gating flag is forced.
      expect(result.current.data?.status).toBe('open');
    });

    it('does not force pollerDead when the cached payload is recent', async () => {
      const cached = makeStatus({ status: 'open', pollerDead: false });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date().toISOString());
      setOnline(false);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.offline).toBe(true));
      expect(result.current.data?.pollerDead).toBe(false);
    });

    it('clears offline on the next successful fetch', async () => {
      const cached = makeStatus({ status: 'open' });
      localStorage.setItem('last-status', JSON.stringify(cached));
      localStorage.setItem('last-status-at', new Date().toISOString());
      setOnline(false);
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(new Response(JSON.stringify(makeStatus({ status: 'restricted' })), { status: 200 }));

      const { result } = renderHook(() => useStatus());
      await waitFor(() => expect(result.current.offline).toBe(true));

      setOnline(true);
      await act(async () => {
        await result.current.refresh();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.current.offline).toBe(false);
      expect(result.current.offlineSince).toBeNull();
      expect(result.current.data?.status).toBe('restricted');
    });
  });
});
