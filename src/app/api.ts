import type { ApiStatus } from '../shared/types';

/** Thrown only when `/api/status` responded (the request reached the
 *  network and came back) but with a non-2xx status. `useStatus` (Task 16)
 *  uses this to tell "server returned an error" apart from "the fetch call
 *  itself rejected" -- a rejected `fetch()` (DNS failure, no connection,
 *  CORS) is the offline-ish case, a resolved-but-not-ok response is not. */
export class HttpStatusError extends Error {
  constructor(public readonly status: number) {
    super(`GET /api/status failed with ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** Plain fetch of our own `/api/status` -- the only endpoint the Home
 *  screen reads (see CLAUDE.md: clients never call WYDOT/Google directly). */
export async function getStatus(): Promise<ApiStatus> {
  const res = await fetch('/api/status');
  if (!res.ok) {
    throw new HttpStatusError(res.status);
  }
  return (await res.json()) as ApiStatus;
}
