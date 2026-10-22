import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/parsers/**/*.test.ts', 'test/scripts/**/*.test.ts'],
  },
});
