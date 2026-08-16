const NWS_ICON_PREFIX = 'https://api.weather.gov/icons/';

/** The only raster types NWS actually serves for icons. Checked against the
 *  type before any `;` parameter (e.g. `image/png; charset=binary`), and
 *  deliberately NOT a `startsWith('image/')` prefix check -- that would also
 *  admit `image/svg+xml`, which is an active document (inline `<script>`
 *  runs same-origin) rather than a raster image, if proxied verbatim from
 *  our own origin. `src/worker/card/route.ts` pins its own Content-Type as a
 *  literal for the same reason; this is the same convention. */
const ALLOWED_ICON_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

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
 * Lowercase-only, no dots, no percent-encoding, at most two segments, each
 * condition name capped at 20 characters (the longest real NWS condition
 * name is 8) -- so `..`, an absolute URL, an encoded traversal, and an
 * unbounded supply of always-missing upstream paths all fail to match. The
 * upstream URL is built from the REGEX MATCH via `exec()`, never by
 * concatenating the raw input string, so even a regex mistake cannot
 * introduce a foreign host.
 */
const ICON_PATH_RX =
  /^land\/(?:day|night)\/[a-z_]{1,20}(?:,\d{1,3})?(?:\/[a-z_]{1,20}(?:,\d{1,3})?)?$/;

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
  // exec(), not test() -- the upstream URL below is built from `match[0]`,
  // the validated match itself, never by concatenating the raw `iconPath`
  // argument. That way a future regex mistake (an unanchored pattern, say)
  // still cannot smuggle anything past this function into the fetch.
  const match = ICON_PATH_RX.exec(iconPath);
  if (!match) {
    return new Response('bad icon path', { status: 400 });
  }

  const fetcher = testIconFetcher ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(`${NWS_ICON_PREFIX}${match[0]}?size=medium`, {
      headers: { 'User-Agent': 'tetonpasscam.com (drew@monroeresidential.com)' },
      // Never follow a redirect: a fixed-host constant is only meaningful if
      // *we* choose the destination. Without this, a 3xx from NWS's CDN
      // would be followed transparently (Workers' fetch default), and the
      // ok/content-type checks below would run against whatever host that
      // redirect pointed to instead of api.weather.gov.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response('icon upstream unavailable', { status: 502 });
  }

  // Never pass through arbitrary bytes: an upstream error page, redirect, or
  // non-raster response is a 502 on our side, not a document served from our
  // origin. `!upstream.ok` alone already rejects the 3xx from `redirect:
  // 'manual'` above, since `ok` is only true for 200-299.
  const contentType = (upstream.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (!upstream.ok || !ALLOWED_ICON_CONTENT_TYPES.has(contentType)) {
    return new Response('icon upstream unavailable', { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
