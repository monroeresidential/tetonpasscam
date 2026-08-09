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

/** True if `payload.generatedAt` (the server's own "produced at" timestamp,
 *  see `ApiStatus.generatedAt`) is more than `OFFLINE_FORCE_UNKNOWN_MS` old.
 *  Unlike a client-side write timestamp, `generatedAt` travels inside the
 *  payload itself, so it still reflects the true origin time even after a
 *  stale Service-Worker-cached response resolves as an ordinary successful
 *  200 (see vite.config.ts's `api-status` runtimeCaching entry) -- that
 *  response's bytes, `generatedAt` included, are exactly what the worker
 *  produced back when the cache entry was written, however recently it was
 *  just re-served. Missing/unparseable `generatedAt` (a pre-upgrade cached
 *  payload, or a test fixture that omits it) is treated as "not stale" here;
 *  that gap is covered by the cache-age guard in the initializer/catch path
 *  below instead. */
function isGeneratedAtStale(payload: ApiStatus, nowMs: number): boolean {
  const generatedMs = Date.parse(payload.generatedAt);
  return Number.isFinite(generatedMs) && nowMs - generatedMs > OFFLINE_FORCE_UNKNOWN_MS;
}

/** Applies the forced-unknown presentation (`pollerDead: true`, everything
 *  else left alone) when `payload` is stale by either measure this hook
 *  tracks: its own `generatedAt` (`isGeneratedAtStale`, above) or
 *  `cacheAgeMs` (how long ago the client itself last wrote/received this
 *  data -- `Infinity` when unknown). Returns the same object reference when
 *  no forcing is needed or `pollerDead` was already true, so callers can use
 *  reference equality to skip a redundant state update. */
function withStaleGuard(payload: ApiStatus, nowMs: number, cacheAgeMs: number): ApiStatus {
  const forced = payload.pollerDead || isGeneratedAtStale(payload, nowMs) || cacheAgeMs > OFFLINE_FORCE_UNKNOWN_MS;
  if (forced === payload.pollerDead) return payload;
  return { ...payload, pollerDead: forced };
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
  const [data, setData] = useState<ApiStatus | null>(() => {
    // Cold start: render a cached payload only through the same staleness
    // guard the offline path applies, rather than showing it raw. Without
    // this, a hanging/never-resolving first fetch (e.g. a dead connection
    // that neither succeeds nor rejects) would leave a stale cached 'open'
    // presented as current indefinitely -- the >2h forced-unknown check
    // previously only ran once a fetch actually FAILED.
    const cached = readCached();
    if (!cached) return null;
    const cachedAt = readCachedAt();
    const cacheAgeMs = cachedAt ? Date.now() - cachedAt.getTime() : Infinity;
    return withStaleGuard(cached, Date.now(), cacheAgeMs);
  });
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
      const now = new Date();
      // Guard even a successful, resolved fetch: a stale Service-Worker
      // cache entry resolves as an ordinary 200 (no rejection, so the catch
      // path below never runs), but `next.generatedAt` still reflects
      // whenever the worker actually produced it -- `cacheAgeMs: 0` here
      // since this data was, from the client's perspective, just obtained.
      setData(withStaleGuard(next, now.getTime(), 0));
      setError(null);
      setOffline(false);
      setOfflineSince(null);
      setRefreshedAt(now);
      lastKnownAt.current = now;
      // Cache the raw payload, not the guarded presentation -- staleness is
      // re-derived from `generatedAt`/cache-age on every read rather than
      // baked into storage, so a later read of this same entry re-evaluates
      // correctly as more real time passes.
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
          const cacheAgeMs = lastKnownAt.current
            ? Date.now() - lastKnownAt.current.getTime()
            : Infinity;
          const presented = withStaleGuard(source, Date.now(), cacheAgeMs);
          // `prev` already holds this exact data (same reference) unless
          // this is a cold start reading straight from cache -- only skip
          // the update in the former case, so the cold-start read always
          // actually lands in state once.
          if (prev && presented === prev) return prev;
          return presented;
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
