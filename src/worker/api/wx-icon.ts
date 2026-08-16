const NWS_ICON_PREFIX = 'https://api.weather.gov/icons/';

/**
 * The complete set of icon paths we will fetch.
 *
 * This handler takes a client-supplied path and makes an outbound request
 * with it, which is an open-proxy primitive unless it is constrained to a
 * fixed shape. Everything about this regex is deliberate:
 *
 *   land/(day|night)/tsra_hi,20/snow,40
 *   ^^^^  ^^^^^^^^^  ^^^^^^^ ^^  ^^^^^^^
 *   fixed  fixed     condition   optional second condition (dual-condition
 *                    + optional  days: "rain,60/snow,40")
 *                    coverage %
 *
 * Lowercase-only, no dots, no percent-encoding, at most two segments -- so
 * `..`, an absolute URL, and an encoded traversal all fail to match. The
 * upstream URL is then built from the MATCH, never by concatenating raw
 * input, so even a regex mistake cannot introduce a foreign host.
 */
const ICON_PATH_RX = /^land\/(?:day|night)\/[a-z_]+(?:,\d{1,3})?(?:\/[a-z_]+(?:,\d{1,3})?)?$/;

/** Test-only fetch override, same pattern as notify.ts's
 *  `setTestEmailFetcher` -- unreachable from any HTTP request. */
let testIconFetcher: typeof fetch | undefined;
export function setTestIconFetcher(f: typeof fetch | undefined): void {
  testIconFetcher = f;
}

/**
 * Rewrite an api.weather.gov icon URL into our own proxy path, or null if it
 * isn't one we're willing to serve. Null is a normal outcome, not an error:
 * the card renders its text without an image.
 */
export function toIconPath(nwsIconUrl: string | null): string | null {
  if (!nwsIconUrl) return null;
  let url: URL;
  try {
    url = new URL(nwsIconUrl);
  } catch {
    return null;
  }
  const full = `${url.origin}${url.pathname}`;
  if (!full.startsWith(NWS_ICON_PREFIX)) return null;
  const path = full.slice(NWS_ICON_PREFIX.length);
  if (!ICON_PATH_RX.test(path)) return null;
  return `/api/wx-icon/${path}`;
}

/**
 * Serve one NWS icon. These URLs are content-addressed by condition (the
 * same path always depicts the same thing), so the response is immutable
 * and cached for a year -- the whole point of proxying rather than
 * hotlinking is that the browser then talks only to us.
 */
export async function getWxIcon(iconPath: string): Promise<Response> {
  if (!ICON_PATH_RX.test(iconPath)) {
    return new Response('bad icon path', { status: 400 });
  }

  const fetcher = testIconFetcher ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(`${NWS_ICON_PREFIX}${iconPath}?size=medium`, {
      headers: { 'User-Agent': 'tetonpasscam.com (drew@monroeresidential.com)' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response('icon upstream unavailable', { status: 502 });
  }

  const contentType = upstream.headers.get('Content-Type') ?? '';
  // Never pass through arbitrary bytes: an upstream error page is a 502 on
  // our side, not an HTML document served from our origin.
  if (!upstream.ok || !contentType.startsWith('image/')) {
    return new Response('icon upstream unavailable', { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
