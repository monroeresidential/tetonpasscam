import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate config from vitest.config.ts (parsers, node env) and
// vitest.workers.config.ts (worker API, workers-pool env) -- this one is
// for React components, which need a DOM (jsdom) and the React plugin for
// JSX/fast refresh-free transform. Kept as its own `npm run test:app`
// script/config rather than folded into vitest.config.ts so the parser
// suite stays fast and dependency-free of jsdom/@testing-library.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // @testing-library/react's automatic post-test `cleanup()` registers
    // itself via a global `afterEach` at import time -- needs globals on to
    // fire; without it, unmounted trees from a prior `it()` in the same
    // file leak into the next one's DOM queries.
    globals: true,
    include: ['test/app/**/*.test.ts', 'test/app/**/*.test.tsx'],
    setupFiles: ['test/app/setup.ts'],
  },
});
