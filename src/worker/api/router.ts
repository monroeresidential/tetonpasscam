import { Hono } from 'hono';
import type { Env } from '../env';
import { getStatus } from './status';

export const api = new Hono<{ Bindings: Env }>();
api.get('/health', (c) => c.json({ ok: true }));
api.get('/status', async (c) => {
  const status = await getStatus(c.env);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(status);
});
