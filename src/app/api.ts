import type { ApiStatus } from '../shared/types';

/** Plain fetch of our own `/api/status` -- the only endpoint the Home
 *  screen reads (see CLAUDE.md: clients never call WYDOT/Google directly). */
export async function getStatus(): Promise<ApiStatus> {
  const res = await fetch('/api/status');
  if (!res.ok) {
    throw new Error(`GET /api/status failed with ${res.status}`);
  }
  return (await res.json()) as ApiStatus;
}
