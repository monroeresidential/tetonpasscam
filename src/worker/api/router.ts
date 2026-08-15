import { Hono } from 'hono';
import type { Env } from '../env';
import { admin } from './admin';
import { getActiveAlerts, postAlert, postCameraError } from './alerts';
import { readJsonCapped } from './body';
import { postFeedback } from './feedback';
import { getHistory } from './history';
import { getStatus } from './status';

// Per-endpoint body size caps for `readJsonCapped` (see body.ts) -- sized to
// comfortably fit each endpoint's legitimate payload (alerts: short enum +
// ≤140-char note + ≤128-char deviceId; feedback: ≤2000-char body + ≤200-char
// email; camera-error: one short enum string) with headroom, while still
// bounding how much an attacker can force the Worker to buffer.
const ALERTS_MAX_BODY_BYTES = 2 * 1024;
const FEEDBACK_MAX_BODY_BYTES = 8 * 1024;
const CAMERA_ERROR_MAX_BODY_BYTES = 1024;

export const api = new Hono<{ Bindings: Env }>();
api.route('/admin', admin);
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
  const parsed = await readJsonCapped(c, ALERTS_MAX_BODY_BYTES);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const result = await postAlert(c.env, parsed.value, ip);
  return c.json(result.body, result.status);
});

api.post('/camera-error', async (c) => {
  const parsed = await readJsonCapped(c, CAMERA_ERROR_MAX_BODY_BYTES);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);
  const result = await postCameraError(c.env, parsed.value);
  return c.json(result.body, result.status);
});

api.post('/feedback', async (c) => {
  const parsed = await readJsonCapped(c, FEEDBACK_MAX_BODY_BYTES);
  if (!parsed.ok) return c.json(parsed.body, parsed.status);
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const result = await postFeedback(c.env, parsed.value, ip);
  return c.json(result.body, result.status);
});

api.get('/history', async (c) => {
  const slug = c.req.query('route');
  if (!slug) return c.json({ error: 'missing route' }, 400);
  // Opt-in only -- see getHistory's includeSummary doc: the summary block
  // drives an expensive full-season travel_times scan the home page's
  // compact chart card never needs, so it stays off unless asked for.
  const includeSummary = c.req.query('summary') === '1';
  const result = await getHistory(c.env, slug, Date.now(), includeSummary);
  if (!result) return c.json({ error: 'not found' }, 404);
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(result);
});
