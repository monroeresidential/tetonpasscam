import { Hono } from 'hono';
import type { Env } from '../env';

export const api = new Hono<{ Bindings: Env }>();
api.get('/health', (c) => c.json({ ok: true }));
