import { and, desc, eq, gt, or, sql } from 'drizzle-orm';

import { CAMERA_IDS, type AlertType, type PublicAlert } from '../../shared/types';
import { alerts, bans, db } from '../db';
import type { Env } from '../env';
import { sendEmail } from '../notify';
import { containsProfanity } from '../profanity';

const CAMERA_ID_SET = new Set<string>(CAMERA_IDS);

/** Hours until an alert of each type auto-expires, added to `created_at` to
 *  produce `expires_at`. Per the brief (overrides the design doc's "closure:
 *  1h or until WYDOT confirms" -- WYDOT-confirmation-based early expiry
 *  isn't implemented here, just the flat 1h). */
export const EXPIRY_HOURS: Record<AlertType, number> = {
  crash: 2,
  stopped: 2,
  slideoff: 2,
  slick: 3,
  wildlife: 3,
  closure: 1,
  other: 2,
};

const ALERT_TYPES = new Set<string>(Object.keys(EXPIRY_HOURS));

const RATE_LIMIT_WINDOW_MIN = 30;
/** A device may have at most this many alert rows in the trailing window;
 *  the (MAX+1)-th request in the window (e.g. the 3rd for MAX=2) is 429'd. */
const DEVICE_RATE_LIMIT_MAX = 2;
/** Same idea, keyed by IP -- a broader net for many-devices-behind-one-IP
 *  abuse (e.g. one person spamming from several browser tabs/incognito
 *  windows, each with a fresh localStorage deviceId). */
const IP_RATE_LIMIT_MAX = 5;

export type PostAlertStatus = 200 | 201 | 400 | 403 | 429;

export interface PostAlertResult {
  status: PostAlertStatus;
  body: Record<string, unknown> | PublicAlert;
}

interface PostAlertBody {
  type?: unknown;
  note?: unknown;
  direction?: unknown;
  deviceId?: unknown;
  website?: unknown; // honeypot -- real users never populate this field
}

/** SHA-256 hex digest of `input`, via the Workers runtime's `crypto.subtle`
 *  (no external dependency). Always 64 lowercase hex characters. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes a raw device/IP identifier before it ever touches storage, logs, or
 * a response body. Salted with `env.ADMIN_TOKEN` so a leaked D1 dump alone
 * doesn't let someone dictionary-reverse a hash back to a real device ID or
 * IP.
 *
 * Rotation caveat: `ADMIN_TOKEN` is also the admin bearer-auth secret (Task
 * 13), so rotating it for that reason silently rotates every future
 * device/ip hash too -- a device/IP banned or rate-limited under the old
 * salt no longer matches under the new one (existing `bans` rows and the
 * 30-min rate-limit window effectively reset for everyone). Acceptable per
 * the brief; if `ADMIN_TOKEN` rotation is ever automated, this coupling
 * should be revisited (e.g. a dedicated `HASH_SALT` secret).
 */
export async function hashIdentifier(env: Env, kind: 'device' | 'ip', value: string): Promise<string> {
  return sha256Hex(`${env.ADMIN_TOKEN}:${kind}:${value}`);
}

/**
 * Builds the fake-success response for a honeypot hit: a `PublicAlert`-
 * shaped body that's indistinguishable in status code and shape from a real
 * `201`, so a bot probing the endpoint can't use the response itself to
 * detect that its submission was silently discarded. `id` is read from the
 * real table's current max (a SELECT, not a write) so it looks like a
 * plausible next-inserted id rather than an obviously-fake constant;
 * `type`/`note`/`direction` echo whatever the caller submitted, coerced to
 * fit the real shape when the submitted value doesn't (e.g. an invalid
 * `type` string falls back to `'other'` rather than leaking a `string` type
 * the real field could never hold). Nothing is persisted and no email is
 * sent for this path -- this function only reads.
 */
async function buildHoneypotResponse(
  env: Env,
  body: PostAlertBody,
  nowMs: number,
): Promise<PublicAlert> {
  const database = db(env);
  const [maxRow] = await database.select({ maxId: sql<number | null>`MAX(${alerts.id})` }).from(alerts);
  const fakeId = (maxRow?.maxId ?? 0) + 1;

  const type: AlertType = typeof body.type === 'string' && ALERT_TYPES.has(body.type)
    ? (body.type as AlertType)
    : 'other';
  const note = typeof body.note === 'string' ? body.note : null;
  const direction: 'wb' | 'eb' | null =
    body.direction === 'wb' || body.direction === 'eb' ? body.direction : null;

  return { id: fakeId, type, note, direction, createdAt: new Date(nowMs).toISOString() };
}

function toPublicAlert(row: {
  id: number;
  type: string;
  note: string | null;
  direction: string | null;
  createdAt: string;
}): PublicAlert {
  return {
    id: row.id,
    type: row.type as AlertType,
    note: row.note,
    direction: row.direction as 'wb' | 'eb' | null,
    createdAt: row.createdAt,
  };
}

/** Assembles `GET /api/alerts` (and the `alerts` array embedded in
 *  `GET /api/status`): active, unexpired rows only, newest first, in the
 *  public shape -- no `device_hash`/`ip_hash`/`status` ever leaves here. */
export async function getActiveAlerts(env: Env, nowMs: number = Date.now()): Promise<PublicAlert[]> {
  const database = db(env);
  const nowIso = new Date(nowMs).toISOString();

  const rows = await database
    .select({
      id: alerts.id,
      type: alerts.type,
      note: alerts.note,
      direction: alerts.direction,
      createdAt: alerts.createdAt,
    })
    .from(alerts)
    .where(and(eq(alerts.status, 'active'), gt(alerts.expiresAt, nowIso)))
    .orderBy(desc(alerts.id));

  return rows.map(toPublicAlert);
}

/**
 * Handles `POST /api/alerts`. Pure request/response logic -- the caller
 * (the Hono route in `router.ts`) is responsible for parsing the JSON body
 * and extracting the `CF-Connecting-IP` header.
 *
 * Order of checks: honeypot short-circuit, then field validation, then
 * profanity, then ban check, then rate limits, then insert + notify. A
 * request that fails an earlier check never reaches -- and never pays the
 * cost of -- a later one (e.g. a honeypot hit never touches the database at
 * all).
 */
export async function postAlert(
  env: Env,
  rawBody: unknown,
  rawIp: string | null,
  nowMs: number = Date.now(),
): Promise<PostAlertResult> {
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as PostAlertBody;

  // Honeypot: a hidden form field real users never fill in. Any non-empty
  // value ⇒ pretend success -- same 201 status and same PublicAlert-shaped
  // body a real acceptance returns (see buildHoneypotResponse) -- but write
  // NOTHING: no alerts row, no email. The response must be indistinguishable
  // from a genuine 201 or a bot probing the endpoint could use the response
  // itself (a differing status/shape) to detect that its submission was
  // silently discarded, then resubmit without the honeypot field.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return { status: 201, body: await buildHoneypotResponse(env, body, nowMs) };
  }

  if (typeof body.type !== 'string' || !ALERT_TYPES.has(body.type)) {
    return { status: 400, body: { error: 'invalid type' } };
  }
  const type = body.type as AlertType;

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > 140) {
      return { status: 400, body: { error: 'invalid note' } };
    }
    note = body.note;
  }

  let direction: 'wb' | 'eb' | null = null;
  if (body.direction !== undefined && body.direction !== null) {
    if (body.direction !== 'wb' && body.direction !== 'eb') {
      return { status: 400, body: { error: 'invalid direction' } };
    }
    direction = body.direction;
  }

  if (typeof body.deviceId !== 'string' || body.deviceId.length === 0) {
    return { status: 400, body: { error: 'invalid deviceId' } };
  }

  if (note !== null && containsProfanity(note)) {
    return { status: 400, body: { error: 'invalid note' } };
  }

  // CF-Connecting-IP is absent for requests that never pass through
  // Cloudflare's edge (e.g. local dev, some test harnesses) -- treat that as
  // the literal string 'unknown' and still hash it, rather than skipping
  // the IP-based rate limit/ban check entirely. This does mean every
  // IP-less request shares one 'unknown' bucket, which is an acceptable
  // coarser fallback for an edge case that shouldn't occur in production.
  const ip = rawIp ?? 'unknown';
  const deviceHash = await hashIdentifier(env, 'device', body.deviceId);
  const ipHash = await hashIdentifier(env, 'ip', ip);

  const database = db(env);

  // Ban check: matches if EITHER the device hash OR the ip hash appears in
  // any bans row (bans.device_hash/ip_hash are individually nullable --
  // an IP-only ban has a null device_hash and vice versa).
  const banMatch = await database
    .select({ id: bans.id })
    .from(bans)
    .where(or(eq(bans.deviceHash, deviceHash), eq(bans.ipHash, ipHash)))
    .limit(1);
  if (banMatch.length > 0) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  const windowStart = new Date(nowMs - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();

  const [deviceCountRow] = await database
    .select({ n: sql<number>`COUNT(*)` })
    .from(alerts)
    .where(and(eq(alerts.deviceHash, deviceHash), gt(alerts.createdAt, windowStart)));
  if ((deviceCountRow?.n ?? 0) >= DEVICE_RATE_LIMIT_MAX) {
    return { status: 429, body: { error: 'rate limited' } };
  }

  const [ipCountRow] = await database
    .select({ n: sql<number>`COUNT(*)` })
    .from(alerts)
    .where(and(eq(alerts.ipHash, ipHash), gt(alerts.createdAt, windowStart)));
  if ((ipCountRow?.n ?? 0) >= IP_RATE_LIMIT_MAX) {
    return { status: 429, body: { error: 'rate limited' } };
  }

  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + EXPIRY_HOURS[type] * 3_600_000).toISOString();

  const [inserted] = await database
    .insert(alerts)
    .values({
      createdAt,
      expiresAt,
      type,
      note,
      direction,
      deviceHash,
      ipHash,
      status: 'active',
    })
    .returning({ id: alerts.id });

  // Best-effort notification -- sendEmail's own contract never throws, so
  // this can't fail the response below regardless of Resend's availability.
  await sendEmail(
    env,
    `New ${type} report on Teton Pass`,
    [
      `Type: ${type}`,
      `Direction: ${direction ?? 'n/a'}`,
      `Note: ${note ?? 'n/a'}`,
      `Reported: ${createdAt}`,
      `Expires: ${expiresAt}`,
    ].join('\n'),
  );

  return {
    status: 201,
    body: toPublicAlert({ id: inserted.id, type, note, direction, createdAt }),
  };
}

/**
 * Handles `POST /api/camera-error` -- a beacon from a camera `<img>`'s
 * `onerror` handler. Throttled to one notification email per camera per UTC
 * calendar day via the `camera_errors(camera, day)` UNIQUE table (an
 * `INSERT OR IGNORE`; the email only fires when the row was actually new).
 *
 * `camera` MUST be one of `CAMERA_IDS` (the canonical 3-cam allowlist in
 * `shared/types.ts`) -- without this check, an unauthenticated caller could
 * submit an unbounded number of distinct `camera` strings and trigger one
 * email per string per day (the per-camera throttle alone doesn't bound the
 * *number* of cameras). Rejecting unknown ids up front caps the worst case
 * at exactly 3 emails/UTC-day, so no separate IP/rate limit is needed here.
 */
export async function postCameraError(
  env: Env,
  rawBody: unknown,
  nowMs: number = Date.now(),
): Promise<{ status: 200 | 400; body: Record<string, unknown> }> {
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as {
    camera?: unknown;
  };
  if (typeof body.camera !== 'string' || !CAMERA_ID_SET.has(body.camera)) {
    return { status: 400, body: { error: 'invalid camera' } };
  }
  const camera = body.camera;

  const now = new Date(nowMs);
  const day = now.toISOString().slice(0, 10); // UTC yyyy-mm-dd
  const createdAt = now.toISOString();

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO camera_errors (camera, day, created_at) VALUES (?, ?, ?)`,
  )
    .bind(camera, day, createdAt)
    .run();

  const isFirstBeaconToday = (result.meta?.changes ?? 0) > 0;
  if (isFirstBeaconToday) {
    await sendEmail(
      env,
      `Camera error: ${camera}`,
      `Camera "${camera}" reported a load error at ${createdAt} (UTC day ${day}).`,
    );
  }

  return { status: 200, body: { ok: true } };
}
