import type { Env } from './env';

const RESEND_URL = 'https://api.resend.com/emails';

/** Resend's verified sending domain for this project is `app.tetonpasscam.com`
 *  (NOT the bare `tetonpasscam.com` apex) -- per Drew, decided outside the
 *  original plan draft. */
export const ALERTS_FROM_ADDRESS = 'alerts@app.tetonpasscam.com';

/** Test-only fetcher override for `sendEmail`'s Resend call, mirroring
 *  `status.ts`'s `setTestNowMs` seam: there is no request-triggerable way to
 *  reach this (no query param, no header, no exported parameter on
 *  `sendEmail` itself -- the brief's produced interface is exactly
 *  `sendEmail(env, subject, text): Promise<void>`), so it's un-abusable from
 *  an actual HTTP request in production. Tests import this module directly
 *  to stub the fetcher and assert on captured Resend calls without ever
 *  hitting the real API. MUST be cleared (`setTestEmailFetcher(undefined)`)
 *  after use so it doesn't leak into later tests sharing this module
 *  instance. */
let testFetcherOverride: typeof fetch | undefined;

/** Test-only: see `testFetcherOverride`. */
export function setTestEmailFetcher(fetcher: typeof fetch | undefined): void {
  testFetcherOverride = fetcher;
}

/**
 * Sends a single notification email to `env.ADMIN_EMAIL` via Resend. Used by
 * the alerts, feedback, and camera-error endpoints to notify Drew of new
 * activity.
 *
 * Never throws into the request path: a failed request is retried once, and
 * if that retry also fails (network error, non-2xx response, or anything
 * else) the failure is swallowed -- a Resend outage must not fail the
 * caller's own request (e.g. a driver's `POST /api/alerts` must still
 * succeed even if the notification email doesn't go out).
 */
export async function sendEmail(env: Env, subject: string, text: string): Promise<void> {
  const fetcher = testFetcherOverride ?? fetch;
  const body = JSON.stringify({
    from: ALERTS_FROM_ADDRESS,
    to: env.ADMIN_EMAIL,
    subject,
    text,
  });

  // 1 initial attempt + 1 retry = 2 total tries, then swallow.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(RESEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.RESEND_KEY}`,
        },
        body,
      });
      if (response.ok) return;
    } catch {
      // Network error / thrown fetch -- fall through and retry (or, on the
      // second attempt, swallow below).
    }
  }
}
