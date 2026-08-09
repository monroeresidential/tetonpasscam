import { Hono } from 'hono';
import type { Env } from '../env';
import { getActiveAlerts, postAlert, postCameraError } from './alerts';
import { postFeedback } from './feedback';
import { getStatus } from './status';

export const api = new Hono<{ Bindings: Env }>();
api.get('/health', (c) => c.json({ ok: true }));
api.get('/status', async (c) => {
  const status = await getStatus(c.env);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(status);
});

api.get('/alerts', async (c) => {
  const list = await getActiveAlerts(c.env);
  return c.json(list);
});

api.post('/alerts', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const result = await postAlert(c.env, body, ip);
  return c.json(result.body, result.status);
});

api.post('/camera-error', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const result = await postCameraError(c.env, body);
  return c.json(result.body, result.status);
});

api.post('/feedback', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const result = await postFeedback(c.env, body);
  return c.json(result.body, result.status);
});
