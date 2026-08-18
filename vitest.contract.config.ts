import { defineConfig } from 'vitest/config';

// Live contract tests (test/contract/**) hit wyoroad.info over the network,
// so they get their OWN config and are excluded from every other suite by
// construction: vitest.config.ts includes only test/parsers/**,
// vitest.workers.config.ts only test/worker/**, vitest.app.config.ts only
// test/app/**. A WYDOT outage or an offline laptop must never be able to fail
// `npm test`. Run deliberately: `npm run test:contract`.
export default defineConfig({
  test: {
    include: ['test/contract/**/*.test.ts'],
    // One network round trip per assertion, with a retry budget for a single
    // transient blip -- a flaky failure here would train the reader to ignore
    // the one test that can detect upstream drift.
    retry: 1,
    testTimeout: 45_000,
    // Stream the tests' own console output instead of capturing it. This
    // suite reports what it actually saw upstream (row counts, cond classes,
    // and whether any closed rows existed to check at all); captured logs
    // would turn a run that verified nothing into an indistinguishable green
    // tick.
    disableConsoleIntercept: true,
  },
});
