const STORAGE_KEY = 'device-id';

/**
 * Returns a stable per-browser identifier: generated once via
 * `crypto.randomUUID()` and persisted in `localStorage` so repeat visits
 * (and repeat report submissions from the same browser) share the same id --
 * this is exactly what `POST /api/alerts`' per-device rate limit (Task 10)
 * hashes and keys off of. Falls back to a fresh, unpersisted UUID if
 * `localStorage` throws (private browsing, disabled storage, quota) rather
 * than crashing the report flow -- that submission just won't share a
 * rate-limit bucket with the user's next one, which is an acceptable
 * degradation.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
