import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { alerts, bans, db, feedback } from '../db';
import type { Env } from '../env';

/**
 * Bearer-token gate for every `/api/admin/*` route (mounted in `router.ts`
 * via `api.route('/admin', admin)`). Registered with `admin.use('*', ...)`
 * so it runs ahead of route matching for EVERY method/path under this
 * sub-app -- including subpaths with no matching route -- so an unknown
 * `/api/admin/whatever` still 401s rather than falling through to Hono's
 * default 404 (which would leak "this endpoint doesn't exist" to an
 * unauthenticated caller and, worse, would let an attacker enumerate real
 * vs. fake admin paths without ever presenting a token).
 *
 * Comparison is timing-safe: both the caller-supplied token and
 * `env.ADMIN_TOKEN` are first hashed with SHA-256 (fixed-length 32-byte
 * digests regardless of input length, so a short/long/empty guess never
 * short-circuits the comparison length check the runtime performs before
 * doing the constant-time byte comparison), then compared with the
 * Workers-runtime extension `crypto.subtle.timingSafeEqual` -- a
 * non-standard Cloudflare Workers API (not in the WebCrypto spec) that
 * compares two buffers in constant time. Hashing first also means the raw
 * token is never held in a plain string comparison anywhere in this path.
 */
// `crypto.subtle.timingSafeEqual` is a real Workers-runtime method (typed in
// `@cloudflare/workers-types`), but this project's single shared `tsconfig`
// also includes the `DOM` lib for the React frontend, and `lib.dom.d.ts`'s
// `SubtleCrypto` (no `timingSafeEqual`) wins type resolution over
// `@cloudflare/workers-types`' version for the global `crypto` value. The
// cast below is purely a type-level workaround for that lib conflict --
// `timingSafeEqual` genuinely exists on `crypto.subtle` at runtime (exercised
// by `test/worker/api-admin.test.ts`'s "correct token" tests).
type WorkersSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(a: BufferSource, b: BufferSource): boolean;
};

async function isValidAdminToken(env: Env, provided: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.ADMIN_TOKEN)),
  ]);
  const subtle = crypto.subtle as WorkersSubtleCrypto;
  return subtle.timingSafeEqual(providedDigest, expectedDigest);
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

export const admin = new Hono<{ Bindings: Env }>();

admin.use('*', async (c, next) => {
  const token = extractBearerToken(c.req.header('Authorization'));
  // Generic body on every failure path -- never distinguishes "missing
  // header" from "wrong token" from "malformed header", and never echoes
  // back anything the caller sent.
  if (!token || !(await isValidAdminToken(c.env, token))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

interface AdminAlertRow {
  id: number;
  createdAt: string;
  expiresAt: string;
  type: string;
  note: string | null;
  direction: string | null;
  deviceHash: string;
  ipHash: string | null;
  status: string;
}

/** All alerts regardless of status (active/expired/removed), newest first,
 *  INCLUDING `deviceHash`/`ipHash` -- unlike the public `GET /api/alerts`,
 *  an admin needs the hashes to be able to ban the device/IP behind a
 *  report. This is the only place in the codebase those hashes are ever
 *  returned in an HTTP response. */
export async function getAllAlerts(env: Env): Promise<AdminAlertRow[]> {
  const database = db(env);
  return database.select().from(alerts).orderBy(desc(alerts.id));
}

/** Soft-deletes an alert: flips `status` to `'removed'`, row is kept (not
 *  deleted) so it still shows up in `getAllAlerts`'s full history. Returns
 *  `false` when `id` doesn't match any row (caller 404s). */
export async function removeAlert(env: Env, id: number): Promise<boolean> {
  const database = db(env);
  const updated = await database
    .update(alerts)
    .set({ status: 'removed' })
    .where(eq(alerts.id, id))
    .returning({ id: alerts.id });
  return updated.length > 0;
}

export type CreateBanResult =
  | { status: 400; body: { error: string } }
  | { status: 201; body: { id: number; deviceHash: string | null; ipHash: string | null; createdAt: string } };

interface CreateBanBody {
  deviceHash?: unknown;
  ipHash?: unknown;
}

/** Inserts a `bans` row. `deviceHash`/`ipHash` are expected to already be
 *  the SHA-256 hashes `postAlert` (Task 10) computes and stores on each
 *  alert row -- the admin page reads them off `GET /api/admin/alerts` and
 *  passes them straight back here, never a raw device id or IP. At least
 *  one of the two fields must be a non-empty string; the ban check in
 *  `postAlert` matches on either column via `OR`, and each column is
 *  individually nullable specifically so a device-only or IP-only ban can
 *  leave the other column NULL. */
export async function createBan(env: Env, rawBody: unknown, nowMs: number = Date.now()): Promise<CreateBanResult> {
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as CreateBanBody;

  const deviceHash = typeof body.deviceHash === 'string' && body.deviceHash.length > 0 ? body.deviceHash : null;
  const ipHash = typeof body.ipHash === 'string' && body.ipHash.length > 0 ? body.ipHash : null;

  if (deviceHash === null && ipHash === null) {
    return { status: 400, body: { error: 'deviceHash or ipHash required' } };
  }

  const database = db(env);
  const createdAt = new Date(nowMs).toISOString();
  const [inserted] = await database
    .insert(bans)
    .values({ deviceHash, ipHash, createdAt })
    .returning({ id: bans.id });

  return { status: 201, body: { id: inserted.id, deviceHash, ipHash, createdAt } };
}

/** All feedback rows, newest first. */
export async function getAllFeedback(env: Env) {
  const database = db(env);
  return database.select().from(feedback).orderBy(desc(feedback.id));
}

admin.get('/alerts', async (c) => {
  const list = await getAllAlerts(c.env);
  return c.json(list);
});

admin.delete('/alerts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
  const removed = await removeAlert(c.env, id);
  if (!removed) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

admin.post('/bans', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const result = await createBan(c.env, rawBody);
  return c.json(result.body, result.status);
});

admin.get('/feedback', async (c) => {
  const list = await getAllFeedback(c.env);
  return c.json(list);
});
