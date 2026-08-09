import { useCallback, useEffect, useRef, useState } from 'react';

import { getStatus } from './api';
import type { ApiStatus } from '../shared/types';

const POLL_MS = 120_000;
const STORAGE_KEY = 'last-status';

export interface UseStatusResult {
  data: ApiStatus | null;
  error: Error | null;
  refreshedAt: Date | null;
  /** Manually triggers the same fetch the mount/poll/visibility effect
   *  uses -- e.g. so a successful report submission can pull the just-added
   *  alert into `data.alerts` immediately instead of waiting up to
   *  `POLL_MS` for the next scheduled poll. Shares the `inFlight` guard, so
   *  calling it while a poll is already in progress is a harmless no-op. */
  refresh: () => Promise<void>;
}

function readCached(): ApiStatus | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ApiStatus) : null;
  } catch {
    // Private browsing / disabled storage -- fall back to no cached data
    // rather than throwing during render.
    return null;
  }
}

function writeCached(data: ApiStatus): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Best-effort only (quota exceeded / private mode) -- the offline shell
    // (Task 16) degrades gracefully without a cached copy.
  }
}

/**
 * Fetches `/api/status` on mount, every `POLL_MS`, and whenever the tab
 * becomes visible again. The mount effect issues exactly one fetch;
 * `visibilitychange` only fires on an actual state transition (not on
 * listener registration), so there is no mount+visibility double-fetch.
 * `inFlight` additionally guards against an overlapping call if visibility
 * flips while a poll is still in flight.
 */
export function useStatus(): UseStatusResult {
  const [data, setData] = useState<ApiStatus | null>(() => readCached());
  const [error, setError] = useState<Error | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getStatus();
      setData(next);
      setError(null);
      setRefreshedAt(new Date());
      writeCached(next);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return { data, error, refreshedAt, refresh };
}
