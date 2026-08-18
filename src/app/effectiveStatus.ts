import type { ApiStatus, PassStatus } from '../shared/types';

/**
 * The status the UI must present, as opposed to the status column's raw
 * value.
 *
 * `pollerDead` means the API's status/conditionText/advisories are
 * last-known rather than current, so every surface has to degrade to UNKNOWN
 * and must not render those fields as if they describe right now. That rule
 * lived inline in StatusBanner and nowhere else; DriveTimes now needs the
 * same answer in order to decide whether route times may be shown at all,
 * and two components deriving a safety-relevant status independently is
 * exactly how they drift apart.
 */
export function effectivePassStatus(data: Pick<ApiStatus, 'status' | 'pollerDead'>): PassStatus {
  return data.pollerDead ? 'unknown' : data.status;
}
