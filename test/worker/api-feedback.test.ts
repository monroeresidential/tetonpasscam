import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { setTestEmailFetcher } from '../../src/worker/notify';

interface CapturedEmail {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  json: { from: string; to: string; subject: string; text: string };
}

/** Stubs the Resend fetcher and returns the array every call gets pushed into.
 *  Callers MUST clear the override afterward. */
function stubEmailFetcher(status = 200): CapturedEmail[] {
  const calls: CapturedEmail[] = [];
  setTestEmailFetcher(async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method,
      headers,
      json: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response('{}', { status });
  });
  return calls;
}

afterEach(() => {
  setTestEmailFetcher(undefined);
});

// Each call defaults to a fresh IP (a distinct TEST-NET-2 address per test,
// mirroring api-alerts.test.ts's convention) so that unrelated tests never
// collide in the per-IP rate limit below -- tests that specifically exercise
// the rate limit pass an explicit, shared `ip`.
let nextTestIp = 1;
function freshTestIp(): string {
  return `198.51.100.${nextTestIp++}`;
}

async function postFeedback(bodyObj: unknown, ip: string = freshTestIp()): Promise<Response> {
  return api.request(
    '/feedback',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify(bodyObj),
    },
    env as any,
  );
}

async function feedbackRowByBody(body: string): Promise<any> {
  return env.DB.prepare('SELECT * FROM feedback WHERE body = ? ORDER BY id DESC LIMIT 1')
    .bind(body)
    .first();
}

async function countFeedbackByIpHash(ipHash: string): Promise<number> {
  const row = (await env.DB.prepare('SELECT COUNT(*) n FROM feedback WHERE ip_hash = ?')
    .bind(ipHash)
    .first()) as { n: number };
  return row.n;
}

describe('POST /api/feedback', () => {
  it('valid POST with body only ⇒ 201, row created with email=null, one email sent', async () => {
    const calls = stubEmailFetcher();
    const body = 'This is great feedback';
    const before = Date.now();

    const res = await postFeedback({ body });
    expect(res.status).toBe(201);

    const row = await feedbackRowByBody(body);
    expect(row).toBeTruthy();
    expect(row.body).toBe(body);
    expect(row.email).toBeNull();

    const createdMs = Date.parse(row.created_at);
    expect(createdMs).toBeGreaterThanOrEqual(before);

    expect(calls).toHaveLength(1);
    expect(calls[0].json.from).toBe('alerts@app.tetonpasscam.com');
    expect(calls[0].json.to).toBe(env.ADMIN_EMAIL);
    expect(calls[0].json.subject).toContain('feedback');
    expect(calls[0].json.text).toContain(body);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${env.RESEND_KEY}`);
  });

  it('valid POST with body and email ⇒ 201, row created with email stored, one email sent with email in text', async () => {
    const calls = stubEmailFetcher();
    const body = 'Great app!';
    const email = 'user@example.com';

    const res = await postFeedback({ body, email });
    expect(res.status).toBe(201);

    const row = await feedbackRowByBody(body);
    expect(row).toBeTruthy();
    expect(row.body).toBe(body);
    expect(row.email).toBe(email);

    expect(calls).toHaveLength(1);
    expect(calls[0].json.text).toContain(body);
    expect(calls[0].json.text).toContain(email);
  });

  it('empty body ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postFeedback({ body: '' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('whitespace-only body ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postFeedback({ body: '   \n\t  ' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('missing body ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postFeedback({ email: 'test@example.com' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('body > 2000 chars ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const body = 'x'.repeat(2001);
    const res = await postFeedback({ body });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('request body over the 8KB cap ⇒ 413, no row, no email (LH T3 finding 7)', async () => {
    const calls = stubEmailFetcher();
    // Oversized at the HTTP-body level, not the validated `body` field
    // level -- a big `email` value inflates the raw JSON past 8KB while
    // still being something the size cap must catch before any field
    // validation runs.
    const oversizedEmail = `${'a'.repeat(8200)}@example.com`;
    const res = await postFeedback({ body: 'feedback text', email: oversizedEmail });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
    expect(calls).toHaveLength(0);
    const row = await feedbackRowByBody('feedback text');
    expect(row).toBeFalsy();
  });

  it('body exactly 2000 chars ⇒ accepted 201', async () => {
    stubEmailFetcher();
    const body = 'y'.repeat(2000);
    const res = await postFeedback({ body });
    expect(res.status).toBe(201);
  });

  it('email without @ ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const res = await postFeedback({ body: 'Good feedback', email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('email > 200 chars ⇒ 400, no row, no email', async () => {
    const calls = stubEmailFetcher();
    const email = 'a'.repeat(200) + '@example.com';
    const res = await postFeedback({ body: 'feedback', email });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('email exactly 200 chars ⇒ accepted 201', async () => {
    stubEmailFetcher();
    const email = 'a'.repeat(180) + '@example.com'; // exactly 200 chars
    const res = await postFeedback({ body: 'feedback', email });
    expect(res.status).toBe(201);
  });

  it('response body is {ok: true}', async () => {
    stubEmailFetcher();
    const res = await postFeedback({ body: 'test feedback' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true });
  });

  it('email send failure does not fail the POST', async () => {
    stubEmailFetcher(500); // Simulate Resend failure
    const body = 'feedback when email service is down';
    const res = await postFeedback({ body });
    expect(res.status).toBe(201);
    // Row should still be created
    const row = await feedbackRowByBody(body);
    expect(row).toBeTruthy();
  });

  describe('per-IP rate limit (Task 17 final review #3)', () => {
    it('4th post from the same IP within an hour ⇒ 429, no row, no email', async () => {
      const calls = stubEmailFetcher();
      const ip = '198.51.100.200';

      const first = await postFeedback({ body: 'rate limit post 1' }, ip);
      const second = await postFeedback({ body: 'rate limit post 2' }, ip);
      const third = await postFeedback({ body: 'rate limit post 3' }, ip);
      expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
      expect(calls).toHaveLength(3);

      const fourthBody = 'rate limit post 4 -- should be blocked';
      const fourth = await postFeedback({ body: fourthBody }, ip);
      expect(fourth.status).toBe(429);
      expect(calls).toHaveLength(3); // unchanged -- no email for the blocked post

      const row = await feedbackRowByBody(fourthBody);
      expect(row).toBeFalsy(); // no row written for the blocked post
    });

    it('different IPs are rate-limited independently', async () => {
      stubEmailFetcher();
      const ipA = '198.51.100.210';
      const ipB = '198.51.100.211';

      for (let i = 0; i < 3; i++) {
        const res = await postFeedback({ body: `ip A post ${i}` }, ipA);
        expect(res.status).toBe(201);
      }
      // ipA is now at its limit, but ipB has made no posts yet.
      const res = await postFeedback({ body: 'ip B post' }, ipB);
      expect(res.status).toBe(201);
    });

    it('rate-limited response body is exactly {error: "rate limited"} -- unchanged by the atomic-insert rewrite (LH T3 finding 5)', async () => {
      stubEmailFetcher();
      const ip = '198.51.100.220';
      await postFeedback({ body: 'body-check post 1' }, ip);
      await postFeedback({ body: 'body-check post 2' }, ip);
      await postFeedback({ body: 'body-check post 3' }, ip);
      const fourth = await postFeedback({ body: 'body-check post 4' }, ip);
      expect(fourth.status).toBe(429);
      expect(await fourth.json()).toEqual({ error: 'rate limited' });
    });

    it('5 simultaneous POSTs from the same IP (Promise.all) ⇒ exactly 3 rows persisted, never more -- regression test for the check-then-insert race the atomic conditional insert closes (LH T3 finding 5)', async () => {
      stubEmailFetcher();
      const ip = '198.51.100.221';

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) => postFeedback({ body: `burst-race post ${i}` }, ip)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 429)).toHaveLength(2);

      // All 5 requests share one IP, so any successfully-inserted row from
      // this burst carries the ip_hash to look the rest up by.
      const successRow = (await env.DB.prepare(
        "SELECT ip_hash FROM feedback WHERE body LIKE 'burst-race post%' LIMIT 1",
      ).first()) as any;
      expect(await countFeedbackByIpHash(successRow.ip_hash)).toBe(3);
    });
  });

  describe('daily email cap (Task 17 final review #3)', () => {
    it('11th feedback email of the UTC day ⇒ 201, row created, but NO email sent', async () => {
      const calls = stubEmailFetcher();
      const today = new Date().toISOString().slice(0, 10);

      // Seed the counter directly rather than making 10 real HTTP posts --
      // same "pre-seed the throttle table" convention used for
      // camera_errors's "prior day already recorded" test. Upserts (rather
      // than a plain INSERT) since earlier tests in this shared-D1-per-file
      // suite have already incremented today's row via their own posts.
      await env.DB.prepare(
        `INSERT INTO feedback_email_counter (day, count) VALUES (?, 10)
           ON CONFLICT(day) DO UPDATE SET count = excluded.count`,
      )
        .bind(today)
        .run();

      const body = 'the 11th feedback email today';
      const res = await postFeedback({ body });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(0); // capped -- no email sent

      const row = await feedbackRowByBody(body);
      expect(row).toBeTruthy(); // row is still written past the email cap
    });

    it('10th feedback email of the UTC day is still under the cap ⇒ email sent', async () => {
      const calls = stubEmailFetcher();
      const today = new Date().toISOString().slice(0, 10);

      await env.DB.prepare(
        `INSERT INTO feedback_email_counter (day, count) VALUES (?, 9)
           ON CONFLICT(day) DO UPDATE SET count = excluded.count`,
      )
        .bind(today)
        .run();

      const res = await postFeedback({ body: 'the 10th feedback email today' });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(1);
    });
  });
});
