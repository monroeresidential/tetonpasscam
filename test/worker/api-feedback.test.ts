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

async function postFeedback(bodyObj: unknown): Promise<Response> {
  return api.request(
    '/feedback',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
});
