import { feedback, db } from '../db';
import type { Env } from '../env';
import { sendEmail, ALERTS_FROM_ADDRESS } from '../notify';

export interface PostFeedbackResult {
  status: 200 | 201 | 400;
  body: Record<string, unknown>;
}

interface PostFeedbackBody {
  body?: unknown;
  email?: unknown;
}

/**
 * Handles `POST /api/feedback`. Writes feedback to the database and sends a
 * notification email to Drew. Email send failure does not fail the response.
 */
export async function postFeedback(
  env: Env,
  rawBody: unknown,
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

  const createdAt = new Date(nowMs).toISOString();

  // Insert the feedback row
  const database = db(env);
  await database
    .insert(feedback)
    .values({
      createdAt,
      body: body.body,
      email,
    });

  // Best-effort notification -- sendEmail never throws
  await sendEmail(
    env,
    'tetonpasscam feedback',
    [body.body, email ?? null]
      .filter((line) => line !== null)
      .join('\n\n'),
  );

  return { status: 201, body: { ok: true } };
}
