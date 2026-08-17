import { api } from './api/router';
import { handleOgRequest, handleShareRequest } from './card/route';
import { handleEmbedRequest } from './embed';
import type { Env } from './env';
import { runNightly } from './poller/aggregate';
import { runPollCycle } from './poller/run';
import { injectLiveStatus } from './seo-inject';

/**
 * Homepage-only path (SEO audit fix #2): serve the static shell from ASSETS,
 * then edge-inject a live-status paragraph into it, cached at the edge for
 * 5 minutes (half the poller's fastest cadence -- wrangler.toml's crons run
 * every 10 min) via `caches.default` so a live D1 read isn't paid on every
 * homepage hit. The browser also honors that same 5-minute Cache-Control;
 * that's fine here since this HTML is only a crawler-facing snapshot -- the
 * live React UI fetches `/api/status` itself and is unaffected.
 */
async function serveHomepage(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Cast needed because the project's single tsconfig includes both `lib:
  // DOM` (for the React app) and `@cloudflare/workers-types` (for the
  // Worker) -- DOM's `CacheStorage` type has no `.default`, so the global
  // `caches` binding type-checks against that one instead of the Workers
  // one. Only `.match`/`.put` are used below, which both `Cache` types agree
  // on.
  const cache = (caches as unknown as { default: Cache }).default;

  // The cache key is scoped to the DEPLOYMENT, not just the URL. Without
  // this, a deploy left the previous build's injected HTML sitting in
  // `caches.default` for up to s-maxage (300s) while that same deploy pruned
  // the content-hashed assets the HTML references -- so every visitor who
  // hit a warm cache during that window loaded `<script src=main-OLD.js>`,
  // got a 404, and saw only the static `#seo-shell` instead of the app.
  // Observed live twice on 2026-08-17: documentElement had the SEO shell and
  // zero React children, with `main-<previous-hash>.js` 404ing.
  //
  // A synthetic key, never a redirect or a user-visible URL: `cache.match`/
  // `cache.put` only use it to address an entry. The version id changes on
  // every deploy, so a new build starts cold and stale entries age out.
  const cacheKey = versionedCacheKey(req, env);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Strip conditional-request headers before asking ASSETS: dist/index.html
  // is a static file with a constant ETag, so a revalidating crawler's own
  // If-None-Match otherwise makes the ASSETS binding itself answer with a
  // bodyless 304 (confirmed empirically) before injectLiveStatus ever runs
  // -- freezing that crawler on whatever content it first saw, forever.
  const assetReq = new Request(req);
  assetReq.headers.delete('If-None-Match');
  assetReq.headers.delete('If-Modified-Since');

  const assetResponse = await env.ASSETS.fetch(assetReq);
  const contentType = assetResponse.headers.get('content-type') ?? '';
  if (assetResponse.status !== 200 || !contentType.includes('text/html')) {
    return assetResponse;
  }

  const injected = await injectLiveStatus(assetResponse, env);
  const finalResponse = new Response(injected.body, injected);
  // s-maxage governs the edge cache (what caches.default stores here);
  // max-age=0 + must-revalidate stops browsers caching this response at
  // all, so a client's own future conditional request always reaches the
  // edge rather than being answered silently from local disk cache.
  finalResponse.headers.set('Cache-Control', 'public, s-maxage=300, max-age=0, must-revalidate');
  // Drop the (file-derived, effectively constant) validators the ASSETS
  // response carried over. Cloudflare's edge automatically downgrades a
  // cacheable 200 with a matching ETag/Last-Modified into a bodyless 304
  // for a conditional request -- without this, that would freeze any
  // revalidating client on its first-ever injected snapshot forever, since
  // the underlying file's ETag never changes even though the injected
  // content changes every 5 minutes.
  finalResponse.headers.delete('ETag');
  finalResponse.headers.delete('Last-Modified');

  ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  return finalResponse;
}

/**
 * The homepage cache key, scoped to the running deployment.
 *
 * Falls back to the literal `'dev'` when the `version_metadata` binding is
 * absent — it does not exist in the vitest-pool-workers runtime, and may be
 * absent in some local dev setups. That fallback is correct in both: no
 * deploy happens mid-test, so there is no stale-asset window to guard
 * against, and a stable key preserves the existing cache-hit behaviour the
 * tests assert.
 */
export function versionedCacheKey(req: Request, env: Env): Request {
  const version = env.CF_VERSION_METADATA?.id ?? 'dev';
  const url = new URL(req.url);
  url.searchParams.set('__v', version);
  // GET-only: `cache.match`/`put` reject other methods, and this path is
  // only reached for a homepage navigation.
  return new Request(url.toString(), { method: 'GET', headers: req.headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Canonical-host redirect (SEO audit fix #6): www is an alias in DNS/the
    // Cloudflare custom-domain routes (wrangler.toml), not a second canonical
    // host -- collapsing it here, before any other routing, keeps exactly
    // one indexable URL per page and avoids duplicate-content signals split
    // across www/apex. 301 (permanent) since this is a durable hostname
    // decision, not a temporary redirect.
    if (url.hostname === 'www.tetonpasscam.com') {
      return Response.redirect(`https://tetonpasscam.com${url.pathname}${url.search}`, 301);
    }
    // share-cards T1: /og/ and /s/ are handled ahead of /api (and ASSETS)
    // -- both return `null` for anything outside their own prefix/method,
    // so this is a no-op for every other request.
    const ogResponse = await handleOgRequest(req, env);
    if (ogResponse) return ogResponse;
    const shareResponse = await handleShareRequest(req, env, ctx);
    if (shareResponse) return shareResponse;
    // Same no-op-outside-its-own-prefix contract as og/share above -- bare
    // `/embed` (the picker page) and anything else outside `/embed/{badge,
    // card,strip}` falls straight through this to the routes below.
    const embedResponse = await handleEmbedRequest(req, env);
    if (embedResponse) return embedResponse;

    if (url.pathname.startsWith('/api/')) {
      return api.fetch(new Request(new URL(url.pathname.slice(4) + url.search, url.origin), req), env, ctx);
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return serveHomepage(req, env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The nightly aggregation job runs on its own dedicated cron entry
    // (10 9 * * *); every other cron entry (the polling cadence, split
    // across three entries to avoid UTC midnight wraparound -- see
    // wrangler.toml) drives the regular poll cycle.
    if (event.cron === '10 9 * * *') {
      ctx.waitUntil(runNightly(env));
    } else {
      ctx.waitUntil(runPollCycle(env));
    }
  },
} satisfies ExportedHandler<Env>;
