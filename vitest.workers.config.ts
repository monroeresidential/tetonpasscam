import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// NOTE: the brief specifies `defineWorkersConfig` from
// `@cloudflare/vitest-pool-workers/config`, but the installed package
// (0.20.3) no longer ships that entrypoint/API — it now exposes a
// `cloudflareTest` Vite plugin instead. This is the equivalent current API;
// it still points at `wrangler.toml` via `wrangler.configPath` and scopes
// the suite to `test/worker/**/*.test.ts` as specified.
//
// D1 migrations: this version also has no `d1Migrations` pool option. It
// does still export `readD1Migrations` and `applyD1Migrations` (the latter
// via the `cloudflare:test` module) from the main entrypoint though, so
// migrations are read here on the Node side and handed to the worker as a
// `TEST_MIGRATIONS` binding; `test/worker/apply-migrations.ts` (registered
// below as a setupFile, which vitest-pool-workers runs inside the Workers
// runtime) applies them before each test file's tests run.
export default defineConfig({
  test: {
    include: ['test/worker/**/*.test.ts'],
    setupFiles: ['./test/worker/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
          ),
        },
      },
    })),
  ],
});
