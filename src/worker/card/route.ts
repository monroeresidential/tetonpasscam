import type { PassStatus } from '../../shared/types';
import type { Env } from '../env';
import { loadCardData, resolveShareCode } from './data';
import { renderCardPng } from './png';

// Share code shape (`YYYYMMDD-HHmm`) baked directly into the path regexes --
// this is the fast, pre-DB reject the design calls for: an old numeric id
// (`/s/53`, `/og/53-eb.png`) or any injection-y string simply never matches
// either pattern, so it falls straight to the existing not-found path below
// without ever reaching `resolveShareCode`/the database.
const SHARE_CODE_SRC = '\\d{8}-\\d{4}';
const OG_PATH_RE = new RegExp(`^/og/(${SHARE_CODE_SRC})-(eb|wb)\\.png$`);
const SHARE_PATH_RE = new RegExp(`^/s/(${SHARE_CODE_SRC})$`);

function cacheApi(): Cache {
  // Same DOM-vs-Workers-types `caches` cast index.ts's serveHomepage
  // already needs (this project's one tsconfig includes both `lib: DOM` and
  // `@cloudflare/workers-types`, and only DOM's ambient `caches` global
  // wins, which has no `.default`).
  return (caches as unknown as { default: Cache }).default;
}

/**
 * `GET /og/{code}-{dir}.png` -- renders the 1200x630 share-card PNG for the
 * snapshot named by `code` (a `YYYYMMDD-HHmm` America/Denver datetime share
 * code -- see `share-code.ts`), `{dir}` ∈ eb|wb. Returns `null` (not a
 * Response) for any request outside the `/og/` prefix or non-GET, so
 * index.ts's fetch() can fall through to its normal routing for those;
 * everything under `/og/` that this function DOES own always resolves to a
 * Response (404 on any failure -- design doc: "card endpoints are
 * best-effort", never a 500).
 */
export async function handleOgRequest(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/og/') || req.method !== 'GET') return null;

  const cache = cacheApi();
  const cached = await cache.match(req);
  if (cached) return cached;

  const match = url.pathname.match(OG_PATH_RE);
  if (!match) {
    return new Response('Not found', { status: 404 });
  }
  const code = match[1];
  const dir = match[2] as 'eb' | 'wb';

  try {
    const id = await resolveShareCode(env, code);
    const cardData = id === null ? null : await loadCardData(env, id, dir);
    if (!cardData) {
      return new Response('Not found', { status: 404 });
    }
    const png = await renderCardPng(cardData);
    const response = new Response(png, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Snapshot data never changes once written (design doc) -- safe to
        // cache forever, both at the browser and (via the explicit
        // caches.default write below) at Cloudflare's edge. This still holds
        // under codes: a code names a fixed Denver-local minute, and once
        // that minute is in the past its snapshot (if any) never changes --
        // the poller's cadence is never faster than 5min (see CLAUDE.md's
        // hard rules), so two snapshots ever sharing one Denver-local
        // minute is impossible, meaning "newest snapshot naming this code"
        // is stable forever after the minute passes.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
    // Deliberately NOT caching the 404 branch above: a code names a future-
    // relative-to-it-being-minted-or-not Denver-local minute -- a code for a
    // minute the poller hasn't written a snapshot for YET (e.g. probed just
    // before that cycle's write) 404s now but could resolve successfully
    // moments later once that snapshot lands. Only ever caching confirmed-
    // successful renders avoids permanently freezing that case at 404.
    await cache.put(req, response.clone());
    return response;
  } catch (err) {
    console.error('renderCardPng failed', err);
    return new Response('Not found', { status: 404 });
  }
}

const STATUS_TITLE_WORD: Record<PassStatus, string> = {
  open: 'OPEN',
  restricted: 'RESTRICTED',
  closed: 'CLOSED',
  unknown: 'UNKNOWN',
};

/**
 * `GET /s/{code}` (+ optional `?dir=wb`) -- serves the app's own HTML (the
 * same `dist/index.html` the homepage serves) with its `og:image`/
 * `twitter:image`/`og:url`/`og:title` meta tags rewritten to point at this
 * specific share: link-preview scrapers (Slack/iMessage/etc unfurl bots)
 * see the status-bearing card, a human clicking through gets the normal
 * live app (React ignores the `/s/{code}` path -- no client routing exists).
 * `canonical` is deliberately left untouched (still `https://
 * tetonpasscam.com/`) -- shares are SEO duplicates of the homepage, not
 * distinct indexable pages (design doc: "/s/* in sitemap -- excluded").
 *
 * Unknown/malformed code -> 302 to `/` rather than a 404: a share link is
 * meant to be clicked, and a dead link should land the visitor on the live
 * site rather than a bare error page.
 */
export async function handleShareRequest(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/s/') || req.method !== 'GET') return null;

  const match = url.pathname.match(SHARE_PATH_RE);
  if (!match) {
    return Response.redirect(`${url.origin}/`, 302);
  }
  const code = match[1];
  const dir: 'eb' | 'wb' = url.searchParams.get('dir') === 'wb' ? 'wb' : 'eb';

  const cache = cacheApi();
  const cached = await cache.match(req);
  if (cached) return cached;

  let cardData;
  try {
    const id = await resolveShareCode(env, code);
    cardData = id === null ? null : await loadCardData(env, id, dir);
  } catch (err) {
    console.error('loadCardData failed for /s/', err);
    cardData = null;
  }
  if (!cardData) {
    return Response.redirect(`${url.origin}/`, 302);
  }

  // Fetch the static shell fresh (no headers copied from `req`, unlike
  // index.ts's serveHomepage) -- `req` targets `/s/{code}`, a URL ASSETS has
  // no file for, so there is no shared ETag/If-None-Match concern to work
  // around here the way serveHomepage has to for `/`.
  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/', url.origin)));
  const contentType = assetResponse.headers.get('content-type') ?? '';
  if (assetResponse.status !== 200 || !contentType.includes('text/html')) {
    return assetResponse;
  }

  const dirSuffix = dir === 'wb' ? '?dir=wb' : '';
  const shareUrl = `${url.origin}/s/${code}${dirSuffix}`;
  const ogImageUrl = `${url.origin}/og/${code}-${dir}.png`;
  const title = `Teton Pass is ${STATUS_TITLE_WORD[cardData.status]} — live conditions`;

  const rewritten = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute('content', ogImageUrl);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(el) {
        el.setAttribute('content', ogImageUrl);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute('content', shareUrl);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', title);
      },
    })
    .transform(assetResponse);

  const finalResponse = new Response(rewritten.body, rewritten);
  // Same pattern (and same reasoning) as index.ts's serveHomepage: s-maxage
  // governs the edge cache this writes to below; max-age=0+must-revalidate
  // stops browsers caching it locally so a repeat visit always reaches the
  // edge rather than silently reusing a stale local copy.
  finalResponse.headers.set('Cache-Control', 'public, s-maxage=300, max-age=0, must-revalidate');
  finalResponse.headers.delete('ETag');
  finalResponse.headers.delete('Last-Modified');

  ctx.waitUntil(cache.put(req, finalResponse.clone()));
  return finalResponse;
}
