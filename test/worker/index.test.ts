// SEO audit fix #6 (www -> apex redirect): this logic lives in the top-level
// `export default { fetch }` in src/worker/index.ts, not in the Hono `api`
// router mounted at /api/* -- every other worker test in this suite calls
// `api.request(...)` directly (see test/worker/api-status.test.ts), which
// never touches this code path. Exercising it needs the real Worker
// entrypoint plus an ExecutionContext, hence `createExecutionContext` from
// `cloudflare:test` instead of the `api.request` shortcut.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../../src/worker/index';

describe('top-level fetch handler', () => {
  it('redirects www.tetonpasscam.com to the apex host with a 301, preserving path and query', async () => {
    const request = new Request('https://www.tetonpasscam.com/some/path?foo=bar');
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://tetonpasscam.com/some/path?foo=bar');
  });

  it('does not redirect the apex host itself', async () => {
    const request = new Request('https://tetonpasscam.com/api/status');
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).not.toBe(301);
  });
});
