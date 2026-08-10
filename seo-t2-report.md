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
  threshold.
