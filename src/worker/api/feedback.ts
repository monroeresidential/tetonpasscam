import { and, eq, gt, sql } from 'drizzle-orm';

import { feedback, db } from '../db';
import type { Env } from '../env';
import { sendEmail, ALERTS_FROM_ADDRESS } from '../notify';
import { hashIdentifier } from './alerts';

export interface PostFeedbackResult {
  status: 200 | 201 | 400 | 429;
  body: Record<string, unknown>;
}

interface PostFeedbackBody {
  body?: unknown;
  email?: unknown;
}

/** A single IP may post at most this many feedback rows in the trailing
 *  window before being 429'd -- mirrors the abuse-prevention pattern in
 *  alerts.ts's `IP_RATE_LIMIT_MAX`, just narrower since feedback has no
 *  per-device identifier to also rate-limit on. */
const IP_RATE_LIMIT_WINDOW_MIN = 60;
const IP_RATE_LIMIT_MAX = 3;

/** Caps the number of feedback *notification emails* sent per UTC calendar
 *  day, independent of the IP rate limit above -- a burst from many distinct
 *  IPs would otherwise still be able to flood Drew's inbox one email per
 *  post. The feedback row is still written past this cap (Drew reads
 *  `/admin.html` regardless); only the best-effort email is skipped. */
export const FEEDBACK_EMAIL_DAILY_CAP = 10;

/**
 * Handles `POST /api/feedback`. Writes feedback to the database and sends a
 * notification email to Drew. Email send failure does not fail the response.
 *
 * Order of checks: field validation, then the per-IP rate limit (a 429 here
 * writes nothing), then the insert (which always happens once validation and
 * the rate limit pass), then the daily email cap gates only the notification
 * email -- never the row write or the response status.
 */
export async function postFeedback(
  env: Env,
  rawBody: unknown,
  rawIp: string | null = null,
  nowMs: number = Date.now(),
): Promise<PostFeedbackResult> {
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as PostFeedbackBody;

  // Validate body: must be a non-empty string with length ≤ 2000
  if (typeof body.body !== 'string' || body.body.trim().length === 0 || body.body.length > 2000) {
    return { status: 400, body: { error: 'invalid body' } };
  }

  // Validate email if present: must contain @ and be ≤ 200 chars
  let email: string | null = null;
  if (body.email !== undefined && body.email !== null) {
    if (typeof body.email !== 'string' || body.email.length > 200 || !body.email.includes('@')) {
      return { status: 400, body: { error: 'invalid email' } };
    }
    email = body.email;
  }

  // Same "absent CF-Connecting-IP still hashed, as 'unknown'" fallback as
  // postAlert -- see hashIdentifier's caller in alerts.ts for the rationale.
  const ip = rawIp ?? 'unknown';
  const ipHash = await hashIdentifier(env, 'ip', ip);

  const database = db(env);

  const windowStart = new Date(nowMs - IP_RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const [ipCountRow] = await database
    .select({ n: sql<number>`COUNT(*)` })
    .from(feedback)
    .where(and(eq(feedback.ipHash, ipHash), gt(feedback.createdAt, windowStart)));
  if ((ipCountRow?.n ?? 0) >= IP_RATE_LIMIT_MAX) {
    return { status: 429, body: { error: 'rate limited' } };
  }

  const createdAt = new Date(nowMs).toISOString();

  // Insert the feedback row
  await database
    .insert(feedback)
    .values({
      createdAt,
      body: body.body,
      email,
      ipHash,
    });

  // Daily email cap: atomically increment today's counter and only send the
  // notification while the post-increment count is still within the cap.
  // `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` keeps this a single
  // round trip with no read-then-write race between concurrent requests.
  const day = createdAt.slice(0, 10); // UTC yyyy-mm-dd
  const counterRow = await env.DB.prepare(
    `INSERT INTO feedback_email_counter (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1
       RETURNING count`,
  )
    .bind(day)
    .first<{ count: number }>();
  const withinDailyEmailCap = (counterRow?.count ?? Infinity) <= FEEDBACK_EMAIL_DAILY_CAP;

  if (withinDailyEmailCap) {
    // Best-effort notification -- sendEmail never throws
    await sendEmail(
      env,
      'tetonpasscam feedback',
      [body.body, email ?? null]
        .filter((line) => line !== null)
        .join('\n\n'),
    );
  }

  return { status: 201, body: { ok: true } };
}
