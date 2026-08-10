# SEO T2 report — edge-inject live status into homepage HTML

Branch: `worktree-seo-fixes`. Baseline after T1: 81/136/154 green (parsers/
worker/app), tsc clean, build clean. Final: 81/154/144 green (144 worker —
136 + 8 new), tsc clean, `npm run build` clean.

## What changed

- `src/worker/seo-inject.ts` (new): `injectLiveStatus(response, env)` builds
  a `<div data-live-status><p>...</p></div>` block from a direct D1 read
  (newest `status_snapshots` row, newest `weather_snapshots` row, newest
  fresh `victor-jackson-eb` `travel_times` row) and appends it into
  `#seo-shell` via `HTMLRewriter`. Reuses `DEAD_HOURS` and
  `TRAVEL_TIME_FRESHNESS_MIN` from `src/worker/api/status.ts` rather than
  re-hardcoding them, and mirrors `getStatus`'s exact "pollerDead or
  already-`unknown` ⇒ never render a status word as current" logic.
  Whole thing wrapped in try/catch; any failure returns the original,
  untransformed `response`.
- `src/worker/index.ts`: new `serveHomepage()`, wired in for `GET /` only
  (after the www-redirect and `/api/*` checks). Checks `caches.default`
  first; on miss, fetches from `env.ASSETS`, injects, sets
  `Cache-Control: public, max-age=300`, and `ctx.waitUntil`s a
  `cache.put`.
- `wrangler.toml`: added `run_worker_first = true` to `[assets]` — **this
  was the one real surprise, see "Harness limitation" below.**
- Rider: `Footer.tsx` and `public/llms.txt`'s `/privacy.html` →
  `/privacy`; updated the pinned `Footer.test.tsx` href assertion.

## Harness limitation hit (flagging per the brief's "STOP and ask" clause)

I did NOT stop, because I found a working fix and could verify it
empirically end-to-end, but this is worth flagging explicitly since it's
exactly the kind of thing the brief asked me to raise.

**The problem:** `test/worker/index.test.ts` and the vitest-pool-workers
environment can exercise `env.ASSETS` and `caches.default` together fine
(confirmed empirically first, before writing any implementation code —
see below), so I built `test/worker/seo-inject.test.ts` against the real
`worker.fetch()` end-to-end rather than a synthetic-Response unit test.
All 8 tests passed immediately. tsc and `npm run build` were clean.

But manual verification via actual `wrangler dev` showed **`GET /`
returning the plain, untransformed shell — no `data-live-status` div at
all**, despite the exact same code passing in the test harness. Cause:
Cloudflare's Assets layer serves a request matching a file on disk (`/` →
`dist/index.html`) **directly, bypassing the Worker's `fetch()` entirely**,
unless `[assets].run_worker_first` is set in `wrangler.toml`. The
vitest-pool-workers test environment calls `worker.fetch()` directly (see
`test/worker/index.test.ts`'s own comment on why it uses
`createExecutionContext` instead of `api.request`), so it can never catch
this class of bug — the test suite has no way to exercise Cloudflare's
real asset-vs-worker routing decision at all. This is a gap in what the
harness can verify, not something fixable by writing a different test; it
only surfaces via an actual `wrangler dev`/deployed request, which is
exactly why the brief's manual-verification step exists.

First fix attempt, `run_worker_first = ["/"]` (scoped narrowly, on the
theory that only the homepage needs the worker to run first): broke
`/api/*` entirely (404 on `GET /api/status`, 405 on `POST /api/alerts`,
caught immediately by `scripts/verify-launch.sh`). Root cause: with no
`run_worker_first` set at all, an unmatched path (no static file, e.g.
`/api/status`) implicitly falls back to invoking the Worker — that's how
`/api/*` worked before this whole feature existed. Setting an *explicit*
`run_worker_first` array apparently turns off that implicit fallback for
every path not in the list, so `/api/*` stopped reaching the Worker too.

Fix: `run_worker_first = true` — every request routes through the Worker
first. `index.ts`'s own routing already does the right thing for every
path that isn't the homepage or `/api/*` (falls through to
`env.ASSETS.fetch(req)` at the bottom), so this is behaviorally equivalent
to the old default for those paths, just with the Worker as one extra
(cheap) hop in front. Re-ran `verify-launch.sh` after the fix: **16
passed, 0 failed** (see transcript below) — `/api/status`, `/api/alerts`
rate-limiting, `/privacy.html`, `/some-random-missing-path` 404, all
recovered.

## Testing approach: full integration, not synthetic Response

Before writing `test/worker/seo-inject.test.ts`, I probed whether
`env.ASSETS` and `caches.default` are both usable in the
vitest-pool-workers environment (the brief said to fall back to a
synthetic-Response unit test + manual wrangler-dev-only verification if
not). A throwaway scratch test confirmed both work:
`worker.fetch(new Request('https://tetonpasscam.com/'), env, ctx)` served
the real `dist/index.html` (200, `text/html`, contains `id="seo-shell"`),
and `caches.default.put()`/`.match()` round-tripped correctly. So the real
suite hits `worker.fetch()` end-to-end for every case rather than testing
`injectLiveStatus` in isolation.

Cache-key isolation note: `caches.default` persists across tests within
one file (same as D1 — fresh only per file, not per test), so each test
in `seo-inject.test.ts` uses a distinct query string on `/` (e.g.
`/?case=fresh-open`) to get its own cache entry; `url.pathname === '/'` in
`index.ts` ignores the query string, so these still exercise the exact
homepage-injection path.

8 new tests, all passing:

1. Empty DB ⇒ unavailable wording, no status word rendered as current.
2. Fresh open snapshot + weather + travel time ⇒ "Teton Pass is open",
   escaped condition text, temperature, minutes all present.
3. **XSS regression pin**: `conditionText = '<script>alert(1)</script>'`
   ⇒ response contains the escaped
   `&lt;script&gt;alert(1)&lt;/script&gt;`, `data-live-status` block does
   NOT contain a raw `<script>`.
4. Closed status ⇒ includes "do not attempt" + "$750 fine" (hard rule #5's
   literal legal copy, byte-identical to `StatusBanner.tsx`'s
   `CLOSED_LEGAL_COPY`).
5. Snapshot 3h old (> `DEAD_HOURS`) ⇒ unavailable wording, no status word.
6. Snapshot fresh but `status = 'unknown'` (unresolved WYDOT-vs-fallback
   disagreement) ⇒ still unavailable wording, never rendered as current —
   this is the case the brief didn't explicitly spell out but hard rule #1
   requires (never render a stale/invalid status word as current).
7. `/privacy` not transformed — no `data-live-status` div, ASSETS content
   untouched.
8. Cache behavior: two requests to the same cache key, with a DB write in
   between that would change the rendered text if re-read — second
   request still shows the FIRST snapshot's text, proving the 5-minute
   cache is actually being served rather than re-reading D1 every time.

## Injection content samples (from the `wrangler dev` transcript)

Empty DB:
```html
<div data-live-status><p>Current status is temporarily unavailable — check <a href="https://www.wyoroad.info/highway/conditions/RoadClosures.html">Wyoming 511</a>.</p></div>
```

Fresh open snapshot (`status_snapshots.condition_text = 'Road Open'`,
`weather_snapshots.air_f = 31.7`, `travel_times.duration_sec = 2520` on
`victor-jackson-eb`):
```html
<div data-live-status><p>Latest reported status (as of 1:00 PM MT, Aug 10): Teton Pass is open — "Road Open". Summit air temperature 32°F. Victor to Jackson is currently running about 42 minutes.</p></div>
```

(31.7°F rounds to 32°F; 2520s = 42.0 min exactly.)

Closed-status test case (from the unit test, not wrangler dev):
```
Teton Pass is closed — "Closed for avalanche control". Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).
```

XSS pin (from the unit test): stored `conditionText` was literally
`<script>alert(1)</script>`; the rendered block contains
`&lt;script&gt;alert(1)&lt;/script&gt;` and no raw `<script>` tag.

## Cache behavior (empirical, via wrangler dev)

- First request to a URL: D1 read, `Cache-Control: public, max-age=300`
  set, response stored via `ctx.waitUntil(cache.put(...))`.
- Same URL again, even after the DB changes underneath it: **same cached
  response returned** (confirmed by inserting a fresh `open` snapshot,
  curling `/?verify=1` → shows "open", then deleting all
  `status_snapshots`/`weather_snapshots`/`travel_times` rows and curling
  the *same* `/?verify=1` again → still shows the stale-but-cached "open"
  content, proving the 5-minute cache is live).
- A *different* URL (`/?verify=2`) after the same DB wipe → fresh D1 read
  → correctly shows "temporarily unavailable".
- `/privacy` and `/some-random-missing-path` are never touched by any of
  this — confirmed 0 occurrences of `data-live-status` on `/privacy`, and
  404 still fires for the missing path.

## `wrangler dev` manual verification transcript

```
$ npm run build                          # clean
$ npm run db:migrate:local                # "No migrations to apply!" (already applied)
$ wrangler dev --port 8788 --local

# BEFORE the run_worker_first fix:
$ curl -s -D - http://localhost:8788/ | head -6
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: public, max-age=0, must-revalidate     # <- ASSETS' own header, not ours
CF-Cache-Status: HIT                                  # <- served by the Assets layer directly
$ grep -c data-live-status <body>
0                                                       # <- our code never ran

# AFTER adding run_worker_first = true and restarting:
$ curl -s -D - http://localhost:8788/ | head -6
HTTP/1.1 200 OK
Cache-Control: public, max-age=300                     # <- ours
$ grep -o '<div data-live-status>.*</div>' <body>
<div data-live-status><p>Current status is temporarily unavailable — check <a href="...">Wyoming 511</a>.</p></div>

# seeded routes + a fresh status/weather/travel-time row, then:
$ curl -s "http://localhost:8788/?verify=1" | grep -o '<div data-live-status>.*</div>'
<div data-live-status><p>Latest reported status (as of 1:00 PM MT, Aug 10): Teton Pass is open — "Road Open". Summit air temperature 32°F. Victor to Jackson is currently running about 42 minutes.</p></div>

# deleted all status_snapshots/weather_snapshots/travel_times rows, then:
$ curl -s "http://localhost:8788/?verify=1" | grep -o '<div data-live-status>.*</div>'   # SAME url -> cache hit
<div data-live-status><p>Latest reported status (as of 1:00 PM MT, Aug 10): Teton Pass is open — "Road Open". ...</p></div>
$ curl -s "http://localhost:8788/?verify=2" | grep -o '<div data-live-status>.*</div>'   # NEW url -> fresh D1 read
<div data-live-status><p>Current status is temporarily unavailable — check <a href="...">Wyoming 511</a>.</p></div>

$ bash scripts/verify-launch.sh http://localhost:8788
== 16 passed, 0 failed ==     # (0 failed AFTER the run_worker_first fix; was 12 passed/4 failed before)

$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/privacy
200
$ curl -s http://localhost:8788/privacy | grep -c data-live-status
0
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/nonexistent-xyz
404
```

## Final verification

- `npm run test` (parsers): 81/81 passed
- `npm run test:worker`: 144/144 passed (136 baseline + 8 new)
- `npm run test:app`: 154/154 passed
- `npx tsc --noEmit`: clean (one cast needed in `index.ts` — the project's
  single tsconfig includes both `lib: DOM` and `@cloudflare/workers-types`,
  and DOM's `CacheStorage` type has no `.default`; documented inline)
- `npm run build`: clean
- `scripts/verify-launch.sh http://localhost:8788`: 16/16 passed (after
  the `run_worker_first` fix)

## Notes / things Drew may want to know

- `run_worker_first = true` means every single request (including static
  JS/CSS/font/image assets) now makes a Worker execution hop before
  falling through to `env.ASSETS.fetch()` for the ones the Worker doesn't
  handle itself. This is a small, universal overhead that didn't exist
  before this change. I judged it worth it given the alternative
  (`run_worker_first: [...]` with an explicit path list) silently breaks
  any current or future path that needs implicit worker-fallback behavior
  (like `/api/*`) unless it's kept in perfect sync with that list — a
  fragile invariant I'd rather not leave behind. Flagging in case Drew
  wants to revisit with a longer allowlist instead (e.g.
  `["/", "/api/*"]`) to shave that hop off static asset requests; I didn't
  do that myself since it reintroduces the "must remember to update this
  list" fragility for comparatively little upside on already-cheap static
  asset serving.
- Weather is included whenever a reading exists, without its own
  freshness gate (unlike the API's `weatherStale` flag) — the brief only
  asked for airF/reportedAt without specifying gating, and `getStatus`
  itself returns last-known weather regardless of staleness (with a
  separate `weatherStale` boolean the API layer surfaces), so I matched
  that "last-known beats nothing" behavior rather than inventing a new
  threshold. **Superseded by the fix wave below** — this HTML snapshot has
  no `weatherStale` flag to attach to a stale reading the way the JSON API
  does, so "last-known beats nothing" was the wrong call here specifically;
  the fix wave now gates it on `WEATHER_STALE_MIN` and omits the sentence
  entirely when stale.

---

## Fix wave (post-review, same day)

Branch review came back "merge WITH FIXES": 2 critical + 3 important. All
five addressed in one commit on top of the original. Final: 148/81/156
green (worker went 144 → 148: 4 new tests), tsc clean, build clean.

### Critical 1 — stale ETag defeats injection for revalidating crawlers

`serveHomepage` was forwarding the ASSETS response's `ETag`/`Last-Modified`
straight through into the injected response. Confirmed empirically (a
throwaway scratch test, before touching any implementation code) that
`env.ASSETS.fetch()` itself answers a request carrying a matching
`If-None-Match` with a bodyless **304** — so a revalidating crawler that
cached the homepage's ETag on its first crawl would get an empty 304 on
every later crawl, forever, and `injectLiveStatus` would never even run.

Fix in `src/worker/index.ts`'s `serveHomepage`:
- Strip `If-None-Match`/`If-Modified-Since` from the request before calling
  `env.ASSETS.fetch` (via `new Request(req)` + `.headers.delete(...)`), so
  the ASSETS binding always returns a full 200 body regardless of what the
  incoming request's conditional headers say.
- Delete `ETag`/`Last-Modified` from the final response before both
  returning it and `cache.put`-ing it — these validators are derived from
  the *static file*, which never changes even though the injected content
  does every 5 minutes; leaving them in place would let Cloudflare's own
  edge (which automatically downgrades a cacheable 200 with a matching
  validator into a 304 for a conditional request) freeze a revalidating
  client on its first-ever snapshot. This second half isn't reproducible
  inside the vitest-pool-workers harness (no real edge sits in front of
  `worker.fetch()` there) — flagging so it's understood as reasoned-through
  rather than test-verified on that specific point; the first half (the
  ASSETS-binding-level 304) *is* directly reproducible and is what the new
  automated test pins.

New test (`test/worker/seo-inject.test.ts`, "a conditional request
carrying the underlying asset's ETag still gets a fresh 200..."): learns
the real, constant ETag of the built `dist/index.html` via a direct
`env.ASSETS.fetch()` call (bypassing our own code), then issues the actual
request through `worker.fetch()` with that exact ETag as `If-None-Match`.
Asserts **200** (not 304) with `data-live-status` present, and no `ETag`
header on the response.

**Empirical `wrangler dev` confirmation** (not just the unit test): briefly
flipped `run_worker_first` off (git-checkout'd back immediately after) to
learn the real raw asset ETag directly from the ASSETS layer
(`"1bf39373a9d3702d756c4e8c96e9988b"`), restored the config, restarted
`wrangler dev`, then:
```
$ curl -s -D - -o body.html -H 'If-None-Match: "1bf39373a9d3702d756c4e8c96e9988b"' "http://localhost:8789/?fixwave=etag-real" | grep -iE "^HTTP|etag|cache-control"
HTTP/1.1 200 OK
Cache-Control: public, s-maxage=300, max-age=0, must-revalidate
$ grep -o '<div data-live-status>.*</div>' body.html
<div data-live-status><p>Current status is temporarily unavailable — check <a href="...">Wyoming 511</a>.</p></div>
```
200, no ETag, live-status content present — the exact request that used to
304 now works.

### Critical 2 — SW serves the app shell at /privacy for repeat visitors

`vite.config.ts`'s `navigateFallbackDenylist` only listed the `.html`
originals (`/admin.html`, `/privacy.html`), not the pretty URLs Footer.tsx/
llms.txt now link to (`/admin`, `/privacy`) — so an installed PWA visitor
whose SW already precached `index.html` would get the app shell silently
served at `/privacy` instead of the real static page, since the SW
intercepts the navigation before Cloudflare's own `.html`-stripping
redirect (what makes the pretty URL work at all outside the SW) ever gets
a chance to run.

Fix: added `/^\/admin$/` and `/^\/privacy$/` to the denylist array
alongside the existing two entries.

Verified in the actual built artifact, not just the source:
```
$ npm run build
$ grep -o '.\{80\}admin.\{80\}' dist/sw.js
te(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[/^\/admin\.html$/,/^\/privacy\.html$/,/^\/admin$/,/^\/privacy$/,/^\/api\//]})),e.register...
```
All four path patterns plus the `/api/` defensive entry are present in the
generated `NavigationRoute`'s denylist.

New regression pin: `test/app/pwa-config.test.ts` (tokens.test.ts-style —
reads `vite.config.ts`'s raw source, not the build output, since this test
suite has no build step of its own) asserts all four denylist patterns and
the `/api/` entry are present in source. This is what would have caught
the gap in the first place had it existed before Footer.tsx/llms.txt were
repointed to the pretty URLs.

### Important 3 — capturedAt mislabeled as reported time

`buildLiveStatusHtml` was formatting `newest.capturedAt` (our own poll
time) into the "as of" timestamp — exactly the mislabeling this repo
already fixed once for weather (`weatherSnapshots.reportedAt`'s own
comment in `db/schema.ts` documents the same trap). Fixed in
`src/worker/seo-inject.ts`: now prefers `newest.wydotReportTime` (WYDOT's
own report time) when it's present *and* parses as a valid date;
otherwise reworded to `as of our last check {time}` using `capturedAt`
instead of silently passing capture time off as a WYDOT report time it
isn't.

Two new tests: one seeds a `wydotReportTime` distinctly different from
`capturedAt` and asserts the rendered block uses *that* hour/minute (not
capturedAt's); one seeds `wydotReportTime: null` (the crosscheck-sourced
case, which never carries one) and asserts the reworded "our last check"
phrasing appears.

### Important 4 — weather rendered with no freshness gate

Imported `WEATHER_STALE_MIN` from `src/worker/api/status.ts` (already used
by `getStatus`'s `weatherStale` flag) and gated the temperature sentence on
it: a weather row older than `WEATHER_STALE_MIN` (60 min) based on our own
`capturedAt` is omitted entirely rather than shown unflagged, since this
one-line crawler snapshot has no separate stale-flag field to attach the
way the JSON API response does.

New test: seeds a fresh open snapshot but a 70-minute-old weather row;
asserts the block contains the status but no `°F` anywhere.

### Important 5 — browser max-age deploy hazard

Changed the injected response's `Cache-Control` from `public, max-age=300`
to `public, s-maxage=300, max-age=0, must-revalidate` in
`src/worker/index.ts`: `s-maxage` keeps the 5-minute edge/CDN caching
behavior (what `caches.default` stores), while `max-age=0` +
`must-revalidate` stop browsers from caching this response locally at all
— pairs with the ETag/Last-Modified removal above, since without a
validator a "must-revalidate" browser request would otherwise have nothing
to conditionally revalidate *with*, always doing a full fetch instead.
This also directly protects against a deploy-day hazard: a browser that
had cached the old `max-age=300` response wouldn't see new deploys
reflected in the injected content for up to 5 minutes even after a fresh
edge cache entry existed.

Both `Cache-Control` pins in `test/worker/seo-inject.test.ts` (the
fresh-open test and the cache-behavior test) updated to the new value;
also added assertions that `ETag`/`Last-Modified` are absent from the
response.

### Final verification (fix wave)

- `npm run test` (parsers): 81/81 passed
- `npm run test:worker`: 148/148 passed (144 → 148: 4 new tests)
- `npm run test:app`: 156/156 passed (154 → 156: the new `pwa-config.test.ts`)
- `npx tsc --noEmit`: clean
- `npm run build`: clean
- `dist/sw.js` grep: denylist contains all 4 path patterns + `/api/`
- `scripts/verify-launch.sh` against `wrangler dev` (post-fix): 16/16
  passed
- Manual `wrangler dev` ETag check (above): confirmed 200 (not 304), no
  `ETag` header, live-status content present, using the *real* asset ETag
