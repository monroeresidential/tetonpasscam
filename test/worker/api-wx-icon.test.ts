import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { setTestIconFetcher, toIconPath } from '../../src/worker/api/wx-icon';

afterEach(() => setTestIconFetcher(undefined));

/** Records the upstream URL the proxy actually requests. */
function captureFetcher(): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch & { urls: string[] };
  f.urls = urls;
  return f;
}

describe('toIconPath', () => {
  it('rewrites a real NWS icon URL to our own path, dropping their size param', () => {
    expect(toIconPath('https://api.weather.gov/icons/land/day/snow?size=small')).toBe(
      '/api/wx-icon/land/day/snow',
    );
  });

  it('keeps the comma-coded and dual-condition composites NWS actually emits', () => {
    expect(toIconPath('https://api.weather.gov/icons/land/day/tsra_hi,20?size=small')).toBe(
      '/api/wx-icon/land/day/tsra_hi,20',
    );
    expect(toIconPath('https://api.weather.gov/icons/land/night/rain,60/snow,40?size=medium')).toBe(
      '/api/wx-icon/land/night/rain,60/snow,40',
    );
  });

  it('returns null for null, a foreign host, or a malformed path', () => {
    expect(toIconPath(null)).toBeNull();
    expect(toIconPath('https://evil.example/icons/land/day/snow')).toBeNull();
    expect(toIconPath('https://api.weather.gov/icons/../../etc/passwd')).toBeNull();
    expect(toIconPath('not a url')).toBeNull();
  });
});

describe('GET /api/wx-icon/*', () => {
  it('serves a valid icon and caches it immutably', async () => {
    const fetcher = captureFetcher();
    setTestIconFetcher(fetcher);

    const res = await api.request('/wx-icon/land/day/tsra_hi,20', {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('immutable');

    // Upstream is built from the validated match, with size forced.
    expect(fetcher.urls).toEqual([
      'https://api.weather.gov/icons/land/day/tsra_hi,20?size=medium',
    ]);
  });

  it('rejects a literal dot-dot before it ever reaches our route', async () => {
    // `api.request()` builds a real `Request`, and the WHATWG URL parser
    // collapses dot-segments during that construction -- before Hono ever
    // sees the path. `/wx-icon/../../secret` (and its `%2e%2e`-encoded
    // equivalent, since dots aren't reserved and decodeURI resolves them too)
    // arrives as `/secret`, matches no route, and is handled by Hono's
    // default not-found -- our regex is never reached because the platform
    // neutralized the input one layer earlier. This is deliberately a 404,
    // not a 400 like its siblings below: don't "fix" it to match them.
    const fetcher = captureFetcher();
    setTestIconFetcher(fetcher);

    const res = await api.request('/wx-icon/../../secret', {}, env as any);
    expect(res.status).toBe(404);
    expect(fetcher.urls).toEqual([]);
  });

  it('rejects traversal, foreign hosts, and junk without fetching anything', async () => {
    const fetcher = captureFetcher();
    setTestIconFetcher(fetcher);

    for (const path of [
      // Percent-encoded slashes are NOT decoded by the URL parser's
      // dot-segment collapse (unlike plain ".." or "%2e%2e" above), so this
      // one actually reaches our route as the literal tail
      // "..%2f..%2fsecret" -- it's our regex, not the platform, that has to
      // reject it.
      '/wx-icon/..%2f..%2fsecret',
      '/wx-icon/https://evil.example/x.png',
      '/wx-icon/land/day/SNOW',
      '/wx-icon/sea/day/snow',
      '/wx-icon/land/day/snow,9999',
      '/wx-icon/',
    ]) {
      const res = await api.request(path, {}, env as any);
      expect(res.status, path).toBe(400);
    }
    expect(fetcher.urls).toEqual([]);
  });

  it('ignores client-supplied query params rather than forwarding them', async () => {
    const fetcher = captureFetcher();
    setTestIconFetcher(fetcher);
    await api.request('/wx-icon/land/day/snow?size=large&x=1', {}, env as any);
    expect(fetcher.urls).toEqual(['https://api.weather.gov/icons/land/day/snow?size=medium']);
  });

  it('returns 502 when upstream fails or serves a non-image', async () => {
    setTestIconFetcher((async () => new Response('nope', { status: 404 })) as typeof fetch);
    expect((await api.request('/wx-icon/land/day/snow', {}, env as any)).status).toBe(502);

    setTestIconFetcher(
      (async () =>
        new Response('<html/>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as typeof fetch,
    );
    expect((await api.request('/wx-icon/land/day/snow', {}, env as any)).status).toBe(502);
  });
});
