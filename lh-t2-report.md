# LH T2: staleness hardening — report

Baseline: 78/109/138 (parsers/worker/app) green after T1. Final: 78/123/145 green (+14 worker, +7 app). `npx tsc --noEmit` clean (both the real `tsconfig.json` scope and a temporary include-`test/`-too check — the only errors there are pre-existing `cloudflare:test` module-resolution errors in `test/worker/**`, unrelated to this work and present before these changes). `npm run build` clean.

## Finding 2 — client keeps stale OPEN through non-offline failures

`src/app/useStatus.ts`:

- **(a)** The `refresh()` catch block no longer gates the stale-age guard on `isOfflineError(err)`. It now always re-applies `withStaleGuard` against whatever's currently displayed (`prev ?? readCached()`), using the existing `lastKnownAt`-based `cacheAgeMs` calculation. `offline`/`offlineSince` are still only set inside the `isOfflineError` branch — only the staleness re-evaluation itself was unconditional.
- **(b)** `src/app/api.ts`'s `getStatus()` now passes `{ signal: AbortSignal.timeout(15_000) }` to `fetch`. A hung request now rejects with an `AbortError` after 15s, which lands in the same catch block as any other rejection, so `inFlight.current = false` in `finally` still runs — verified by a dedicated test (mocks `AbortSignal.timeout` to return a controllable `AbortController`'s signal, fires it manually, then confirms a subsequent `refresh()` issues a real second `fetch` call).
- **(c)** Added a second `useEffect` in `useStatus` running a `setInterval(..., WATCHDOG_MS /* 60_000 */)` that re-runs `withStaleGuard` against the current `data` state directly — no fetch involved. This is the only guard that still fires if every refresh attempt hangs or fails silently. Cleaned up via `clearInterval` on unmount, mirroring the existing poll-interval effect.

Tests added to `test/app/useStatus.test.ts` (new describe `stale-guard on every failed refresh + independent watchdog (LH T2 finding 2)`):
- A repeated 500 response with a >2h-old currently-displayed payload forces `pollerDead: true`, while `offline` stays `false` (proving it's not the offline path).
- A permanently-hanging `fetch` mock + the watchdog's own timer (full fake timers, advanced past 2h+1min) forces `pollerDead: true` with zero fetches ever settling.
- A mocked `AbortSignal.timeout` + manual `controller.abort()` proves the timeout releases `inFlight` (a subsequent `refresh()` fires fetch #2).

Also fixed the pre-existing "fetches exactly once on mount" test's exact-args assertion (now expects the URL + `expect.objectContaining({ signal: expect.anything() })`, since `fetch` now always carries a signal).

## Finding 3 — missing/invalid/future wydotReportTime treated as fresh

`src/worker/api/status.ts`: added `isReportTimeStale(wydotReportTime, nowMs)` — true when the value is null, unparseable, more than `STALE_HOURS` (12) in the past, or more than the new `FUTURE_SKEW_TOLERANCE_MIN` (15) minutes in the future. `isStale` is now computed via this helper whenever `newest.status !== 'unknown'` (previously it was computed for ANY snapshot as long as `wydotReportTime` was truthy — missing/invalid values silently left `isStale` at its default `false`). An already-`'unknown'` newest snapshot is left at `isStale: false` — there's no report to judge staleness against.

This closes the exact gap called out: every `'crosscheck'`-sourced row has `wydotReportTime: null` by construction (see `run.ts`'s `unknownStatusResult`/crosscheck-verdict path) and previously always read as fresh; now it correctly reports `isStale: true`.

Tests added (`test/worker/api-status.test.ts`, new describe `isStale (LH T2 finding 3 ...)`): null, unparseable string, 20min-future (beyond tolerance, stale), 10min-future (within tolerance, not stale), `'unknown'`-status snapshot with null time (stays not-stale), and an explicit `source: 'crosscheck'` row (now stale).

**Fixed a pre-existing test that the new rule broke as a side effect**: "a posted community alert appears in alerts[] ... isStale" inserted its snapshot with no `wydotReportTime` and asserted `isStale: false` — that assertion was only ever true because of the exact bug this finding targets. Added a fresh `wydotReportTime` to that insert so the test isolates its actual intent (community reports don't touch status/pollerDead/isStale) without incidentally depending on the missing-time bug.

## Finding 4 — secondary data never expires

`src/worker/api/status.ts`, three independent freshness windows:

- **travelTimes**: added `TRAVEL_TIME_FRESHNESS_MIN = 30`. `latestTravelRows` is now `.filter()`ed by `nowMs - Date.parse(row.capturedAt) <= 30min` before the existing typicals-lookup `.map()` — a stale route is omitted entirely (same "no valid placeholder" contract as zero-history routes), not shown with a misleadingly-current duration.
- **weather**: added `WEATHER_STALE_MIN = 60` and a new `weatherStale: boolean` field on `ApiStatus` (`src/shared/types.ts`), computed from the newest `weather_snapshots` row's own `capturedAt` age (independent of the `reportedAt` fix below — a poller outage should flag staleness even if WYDOT's last-fetched timestamp still looks recent). The reading itself is still returned when stale (last-known beats nothing for a stat strip).
- **id33Advisory**: added `ID33_MAX_AGE_HOURS = 24`. The active-events query result is now `.filter()`ed by `nowMs - Date.parse(e.capturedAt) <= 24h` before the full-closure-preference logic runs, so a stale active event we simply never got a fresher read on stops surfacing indefinitely.

### The `weatherStale`/reportedAt rider — survey result

Surveyed `weather_snapshots` (`src/worker/db/schema.ts`), the poller's insert (`src/worker/poller/run.ts` step 3), and the API's read (`status.ts`). Confirmed the bug: **the schema had no column for the parser's own report timestamp at all.** `wydot-weather.ts`'s `parseSensorPage` already extracts WYDOT's own "Last Report Time" text into `WeatherReading.reportedAt`, but `run.ts`'s insert never wrote it anywhere, and `status.ts` relabeled `weatherRow.capturedAt` (our own fetch time) as the response's `weather.reportedAt` — so a driver looking at "as of HH:MM" was really seeing "when we last polled," not WYDOT's own reading time.

Fix: added a `reported_at` column to `weather_snapshots` (new migration `migrations/0003_massive_grandmaster.sql`, generated via `npm run db:generate` after editing `schema.ts` — never touched the frozen 0000-0002 migrations), wired `run.ts`'s insert to write `reading.reportedAt` into it, and `status.ts` now exposes `weatherRow.reportedAt` (nullable, same as the parser's contract) instead of `weatherRow.capturedAt`.

`src/app/components/WeatherStrip.tsx` + `src/app/App.tsx`: added a `weatherStale` prop; when true, renders a small muted "Weather may be outdated — (as of h:mm AM)" line above the stat-tile grid (America/Denver, same `Intl.DateTimeFormat` pattern as `StatusBanner`'s time formatting), using the now-correct `reportedAt`. Omits the "(as of ...)" clause gracefully if `reportedAt` is null (parser couldn't find/parse the timestamp text) rather than fabricating one. Tiles still render normally underneath — last-known beats nothing.

Tests added: `test/worker/api-status.test.ts` new describe `weather (LH T2 finding 4 -- reportedAt survey/fix + weatherStale)` (reportedAt reflects WYDOT's time not capturedAt; 59min not stale; 61min stale-but-returned), plus travelTimes 31min-omitted/29min-included tests and an id33 25h-ignored test. `test/app/WeatherStrip.test.tsx` new describe `weatherStale` (no copy when false; "(as of 11:00 AM)" suffix when true, derived from `reportedAt`; tiles still render; suffix omitted gracefully when `reportedAt` is null). `test/worker/poller.test.ts`'s existing "happy path" test extended to assert `reported_at` is non-null and distinct from `captured_at` after a real poll cycle.

## T1-review minor 1 — mergeAgreeing advisories/wydotReportTime

`src/worker/poller/run.ts`'s `mergeAgreeing`:
- **Advisories** now come from whichever side's own `status` matches the merged `status` (the "winning" side) — `fallback.status === status && primary.status !== status ? fallback.advisories : primary.advisories` — instead of a deduped union. Rationale in the updated doc comment: a union let a less-restrictive source's advisory list bleed into a report really describing the other source's conditions.
- **Restrictions** are unchanged — still `dedupeAppend(primary.restrictions, fallback.restrictions)`, per the instruction to keep that a union.
- **`wydotReportTime`** is now `olderReportTime(primary.wydotReportTime, fallback.wydotReportTime)` (new helper: null/unparseable treated as absent, defers to the other side; otherwise picks whichever parses to the earlier instant) — conservative, since a merged report is only as current as its least-current input. Previously always took primary's unconditionally.

Tests added to `test/worker/poller.test.ts`:
- A new fixture derivation `routesresultsWy22RestrictedDistinctAdvisory` (swaps the fallback page's advisory cell to `'Slick Spots'`, distinct from primary's `'Falling Rock'`) proves advisories come from the winning (fallback, since it's the restricted/more-restrictive side) side alone, not a union — while restrictions stay unioned (`['Chain Law Level 1']`).
- Two more fixture derivations (`routesresultsWy22OpenLaterReport` / `...EarlierReport`, shifting only the fallback page's report-time cell) prove `wydotReportTime` resolves to whichever source is actually older in each direction — not "always primary's" (the historical/pre-fix behavior, which the later-fallback case alone can't distinguish from the fix).
- Renamed the old "advisories deduped" test to reflect that with these particular fixtures both sides happen to report the identical advisory, so its outcome is unchanged by the fix (documented in the new title, not just silently left stale).

## Constraints honored

- `pollerDead`/`generatedAt` guards untouched — Finding 2's changes only add new guard paths (unconditional stale re-check, watchdog) and a fetch timeout; nothing about how `pollerDead`/`generatedAt` themselves are computed changed.
- `ApiStatus` gained exactly one additive field (`weatherStale`); updated the one production constructor (`status.ts`'s return statement) and the handful of test fixtures that build a complete `ApiStatus` literal (`test/app/App.test.tsx`, `test/app/StatusBanner.test.tsx`, `test/app/useStatus.test.ts` — confirmed via a temporary tsconfig that includes `test/` that no fixture was missed; `test/worker/api-status.test.ts` never constructs the type by hand, it reads it from the real API).
- No migration file 0000-0002 was edited in place; the schema change is a new `0003_massive_grandmaster.sql`.
- All three suites green, `tsc --noEmit` clean, `npm run build` clean.

## Files changed

- `src/app/useStatus.ts`, `src/app/api.ts` — Finding 2.
- `src/worker/api/status.ts`, `src/shared/types.ts` — Findings 3 & 4.
- `src/worker/db/schema.ts`, `migrations/0003_massive_grandmaster.sql`, `migrations/meta/*` — Finding 4 rider (reportedAt column).
- `src/worker/poller/run.ts` — Finding 4 rider (writes reportedAt) + T1-review minor 1 (mergeAgreeing).
- `src/app/components/WeatherStrip.tsx`, `src/app/App.tsx` — Finding 4 (weatherStale UI).
- Tests: `test/app/useStatus.test.ts`, `test/app/WeatherStrip.test.tsx`, `test/app/App.test.tsx`, `test/app/StatusBanner.test.tsx`, `test/worker/api-status.test.ts`, `test/worker/poller.test.ts`.

No safety-pinned behavior (pollerDead/generatedAt computation, status four-state contract, never-default-to-OPEN) was changed — did not need to stop and ask.
