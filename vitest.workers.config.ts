import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// NOTE: the brief specifies `defineWorkersConfig` from
// `@cloudflare/vitest-pool-workers/config`, but the installed package
// (0.20.3) no longer ships that entrypoint/API — it now exposes a
// `cloudflareTest` Vite plugin instead. This is the equivalent current API;
// it still points at `wrangler.toml` via `wrangler.configPath` and scopes
// the suite to `test/worker/**/*.test.ts` as specified.
export default defineConfig({
  test: {
    include: ['test/worker/**/*.test.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
});
