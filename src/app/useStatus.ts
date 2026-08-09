import { useCallback, useEffect, useRef, useState } from 'react';

import { getStatus, HttpStatusError } from './api';
import type { ApiStatus } from '../shared/types';

const POLL_MS = 120_000;
const STORAGE_KEY = 'last-status';
const STORAGE_AT_KEY = 'last-status-at';

/** Mirrors the worker's `DEAD_HOURS` (src/worker/api/status.ts) -- a cached
 *  payload this old, shown while offline, must not present its own
 *  (possibly still-`open`) status as current. The worker computes
 *  `pollerDead` from its snapshot's age *as of the request that produced
 *  it*; once that response has been sitting in localStorage while the
 *  device is offline, more time keeps passing that the payload itself has
 *  no way to reflect, so the same 2h cutoff is re-applied here against the
 *  client's own clock. */
const OFFLINE_FORCE_UNKNOWN_MS = 2 * 3_600_000;

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
  /** True while the most recent fetch attempt failed for an offline-ish
   *  reason (see `isOfflineError`) -- `data` in this state is last-known,
   *  not current. */
  offline: boolean;
  /** When `offline` is true, the time the currently-displayed `data` was
   *  last actually fetched (either this session's last successful poll, or
   *  -- on a cold load that never got a successful fetch -- the time the
   *  cached copy was written). Null once back online. */
  offlineSince: Date | null;
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

function readCachedAt(): Date | null {
  try {
    const raw = localStorage.getItem(STORAGE_AT_KEY);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch {
    return null;
  }
}

function writeCachedAt(at: Date): void {
  try {
    localStorage.setItem(STORAGE_AT_KEY, at.toISOString());
  } catch {
    // Best-effort only, same as writeCached above.
  }
}

/** A rejected `fetch()` (DNS/connection/CORS failure) or an explicit
 *  `navigator.onLine === false` both indicate the device itself is
 *  offline. A resolved-but-non-ok response (`HttpStatusError`) means the
 *  request reached a server that's unhappy, not that we're offline --
 *  that case keeps the existing "show prior data + surface the error"
 *  behavior instead of the offline banner. */
function isOfflineError(err: unknown): boolean {
  return !navigator.onLine || !(err instanceof HttpStatusError);
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
  const [offline, setOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const inFlight = useRef(false);
  // Tracks "when was the data currently held actually fetched", across both
  // this session's successful polls and a cold-start cached copy -- read
  // (not state) because the offline path needs its value inside the same
  // `catch` that reports it, not on the render after.
  const lastKnownAt = useRef<Date | null>(readCachedAt());

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getStatus();
      setData(next);
      setError(null);
      setOffline(false);
      setOfflineSince(null);
      const now = new Date();
      setRefreshedAt(now);
      lastKnownAt.current = now;
      writeCached(next);
      writeCachedAt(now);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      if (isOfflineError(err)) {
        setOffline(true);
        setOfflineSince(lastKnownAt.current);
        setData((prev) => {
          const source = prev ?? readCached();
          if (!source) return prev;
          const ageMs = lastKnownAt.current
            ? Date.now() - lastKnownAt.current.getTime()
            : Infinity;
          const forcedPollerDead = source.pollerDead || ageMs > OFFLINE_FORCE_UNKNOWN_MS;
          // `prev` already holds this exact data (same reference) unless
          // this is a cold start reading straight from cache -- only skip
          // the update in the former case, so the cold-start read always
          // actually lands in state once.
          if (prev && forcedPollerDead === prev.pollerDead) return prev;
          return { ...source, pollerDead: forcedPollerDead };
        });
      }
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

  return { data, error, refreshedAt, refresh, offline, offlineSince };
}
