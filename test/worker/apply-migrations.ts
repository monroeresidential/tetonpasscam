import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

// Runs once per test file inside the Workers runtime (vitest-pool-workers
// executes `setupFiles` there, where `cloudflare:test` is available). The
// migrations array itself is read on the Node side in
// `vitest.workers.config.ts` and passed in as the `TEST_MIGRATIONS` binding.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(env.DB, TEST_MIGRATIONS);
