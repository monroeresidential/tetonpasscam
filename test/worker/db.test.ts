import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';

describe('seedRoutes', () => {
  it('seeds exactly 12 route directions with unique slugs', async () => {
    await seedRoutes(env.DB);
    const { results } = await env.DB.prepare('SELECT slug FROM routes').all();
    expect(results.length).toBe(12);
    expect(new Set(results.map((r: any) => r.slug)).size).toBe(12);
  });
});
