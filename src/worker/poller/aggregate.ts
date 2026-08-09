import type { Env } from '../env';

/**
 * Stub for the nightly aggregation job (rolls up route_typicals, applies
 * retention, etc.). Task 12 fills this in; for now it just logs so the
 * `scheduled` dispatcher's `10 9 * * *` cron branch has somewhere to go.
 */
export async function runNightly(_env: Env): Promise<void> {
  console.log('[poller] runNightly stub invoked (Task 12 will implement this)');
}
