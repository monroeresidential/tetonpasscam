import type { PassStatus } from '../../shared/types';
import type { Env } from '../env';
import { loadCardData } from './data';
import { renderCardPng } from './png';

const OG_PATH_RE = /^\/og\/(\d+)-(eb|wb)\.png$/;
const SHARE_PATH_RE = /^\/s\/(\d+)$/;

function cacheApi(): Cache {
  // Same DOM-vs-Workers-types `caches` cast index.ts's serveHomepage
  // already needs (this project's one tsconfig includes both `lib: DOM` and
  // `@cloudflare/workers-types`, and only DOM's ambient `caches` global
  // wins, which has no `.default`).
  return (caches as unknown as { default: Cache }).default;
}

/**
 * `GET /og/{id}-{dir}.png` -- renders the 1200x630 share-card PNG for
 * `status_snapshots.id = {id}`, `{dir}` ∈ eb|wb. Returns `null` (not a
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
  const id = Number(match[1]);
  const dir = match[2] as 'eb' | 'wb';

  try {
    const cardData = await loadCardData(env, id, dir);
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
        // caches.default write below) at Cloudflare's edge.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
    // Deliberately NOT caching the 404 branch above: ids are sequential and
    // only ever minted from an already-persisted row (see
    // ApiStatus.statusSnapshotId's comment), so a 404 today can never
    // become valid later for that exact id -- except an attacker could
    // probe an id that hasn't been INSERTed yet but will be (autoincrement
    // keeps growing); caching that speculative 404 as if it were as
    // permanent as a real snapshot's PNG would then wrongly freeze the real
    // one out once it exists. Only ever caching confirmed-successful
    // renders avoids that.
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
 * `GET /s/{id}` (+ optional `?dir=wb`) -- serves the app's own HTML (the
 * same `dist/index.html` the homepage serves) with its `og:image`/
 * `twitter:image`/`og:url`/`og:title` meta tags rewritten to point at this
 * specific share: link-preview scrapers (Slack/iMessage/etc unfurl bots)
 * see the status-bearing card, a human clicking through gets the normal
 * live app (React ignores the `/s/{id}` path -- no client routing exists).
 * `canonical` is deliberately left untouched (still `https://
 * tetonpasscam.com/`) -- shares are SEO duplicates of the homepage, not
 * distinct indexable pages (design doc: "/s/* in sitemap -- excluded").
 *
 * Unknown/malformed id -> 302 to `/` rather than a 404: a share link is
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
  const id = Number(match[1]);
  const dir: 'eb' | 'wb' = url.searchParams.get('dir') === 'wb' ? 'wb' : 'eb';

  const cache = cacheApi();
  const cached = await cache.match(req);
  if (cached) return cached;

  let cardData;
  try {
    cardData = await loadCardData(env, id, dir);
  } catch (err) {
    console.error('loadCardData failed for /s/', err);
    cardData = null;
  }
  if (!cardData) {
    return Response.redirect(`${url.origin}/`, 302);
  }

  // Fetch the static shell fresh (no headers copied from `req`, unlike
  // index.ts's serveHomepage) -- `req` targets `/s/{id}`, a URL ASSETS has
  // no file for, so there is no shared ETag/If-None-Match concern to work
  // around here the way serveHomepage has to for `/`.
  const assetResponse = await env.ASSETS.fetch(new Request(new URL('/', url.origin)));
  const contentType = assetResponse.headers.get('content-type') ?? '';
  if (assetResponse.status !== 200 || !contentType.includes('text/html')) {
    return assetResponse;
  }

  const dirSuffix = dir === 'wb' ? '?dir=wb' : '';
  const shareUrl = `${url.origin}/s/${id}${dirSuffix}`;
  const ogImageUrl = `${url.origin}/og/${id}-${dir}.png`;
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
