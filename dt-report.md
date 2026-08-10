# Datetime share codes — report

## Summary

Replaced `status_snapshots.id`-based share URLs (`/s/{id}`, `/og/{id}-{dir}.png`)
with America/Denver datetime codes `YYYYMMDD-HHmm` (`/s/{code}`,
`/og/{code}-{dir}.png`), matching the card footer's Mountain-time "as of"
timestamp. No back-compat shim: an old numeric id fails the strict code
regex and falls through to the existing 302 (`/s`) / 404 (`/og`) path,
never touching the DB.

## Design implemented

- **New module `src/worker/share-code.ts`** — single source of truth for
  both directions:
  - `formatShareCode(capturedAtIso)` — encodes an ISO instant as its
    Denver-local `YYYYMMDD-HHmm`.
  - `isValidShareCodeFormat(code)` / `shareCodeToUtcWindow(code)` — strict
    `^\d{8}-\d{4}$` check, then the PRIMARY (constant-offset) `[start,
    start+60_000)` UTC window guess. Documented as correct every day except
    the ~2 DST-transition days/year.
- **`src/worker/card/data.ts`** — new `resolveShareCode(env, code)`:
  primary-window DB query first; on a miss, a wider `[start-2h, start+3h)`
  fallback scan that re-derives each candidate row's own code via
  `formatShareCode` and keeps only exact matches (this is what actually
  handles the DST edge case, not the primary window). Multiple matches in
  one minute → newest (`ORDER BY id DESC`). No match anywhere → `null`.
- **`src/worker/card/route.ts`** — `OG_PATH_RE`/`SHARE_PATH_RE` now bake in
  the strict code shape directly (`\d{8}-\d{4}`), so a malformed/old-style
  path never reaches `resolveShareCode` or the DB. Both handlers resolve
  code → id via `resolveShareCode`, then proceed exactly as before through
  `loadCardData(env, id, dir)`. Updated the `/og` cache-immutability
  comments for the new code semantics (a code names a fixed Denver-local
  minute; the "don't cache 404s" reasoning now covers a code for a
  not-yet-written minute rather than a not-yet-inserted id).
- **`ApiStatus.statusSnapshotId: number | null`** → **`shareCode: string |
  null`** in `src/shared/types.ts`, with `getStatus` (`src/worker/api/
  status.ts`) now calling `formatShareCode(newest.capturedAt)`. Same
  nullability semantics (withheld when `pollerDead` or no snapshot).
- **Frontend**: `ShareButton`/`buildShareUrl`, `DriveTimes`, `App.tsx` all
  take/thread `shareCode: string | null` instead of the numeric id. URL
  shape unchanged otherwise (`/s/{code}` + `?dir=wb`).
- `vite.config.ts`'s SW navigate-fallback denylist comment updated
  (`/s/{id}` → `/s/{code}`); the actual regex (`/^\/s\//`) needed no change.

## Tests

- **New `test/parsers/share-code.test.ts`** (pure, no D1): strict-format
  accept/reject table (old numeric id, wrong digit counts, wrong separator,
  injection string, whitespace), encode/decode roundtrip for a summer and a
  winter instant, and two DST-transition-day cases — one *before* the
  spring-forward jump (primary window still correct) and one *after* it
  (primary window proven to drift by exactly 1h, i.e. fallback territory).
- **`test/worker/card-data.test.ts`** — added a `resolveShareCode` describe
  block: malformed code, well-formed-but-unmatched code, primary-window hit,
  DST fallback-scan hit, and newest-wins on a same-minute collision.
- **`test/worker/card-route.test.ts`** — converted all `/og`/`/s` tests from
  ids to codes (via `formatShareCode`); added malformed-code-old-id and
  injection-path-segment 404/302 cases (rejected pre-DB by the route regex),
  a well-formed-but-unknown-code 404/302 case, and an end-to-end DST
  fallback-scan case for both `/og` and `/s`.
- **`test/app/{ShareButton,DriveTimes,App,StatusBanner}.test.tsx`,
  `test/app/useStatus.test.ts`, `test/worker/api-status.test.ts`** — id→code
  fixture/assertion updates, same intent preserved (including the
  `statusSnapshotId ⇒ that row's own id` test rewritten to assert
  `shareCode === formatShareCode(capturedAt)`).

## Verification

Baseline before this work (after `npm run build`, which the worker/app
suites need for the ASSETS binding): 81/176/168 = 425 passed, 0 failed.

After this change:
- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `npm run test` — 96/96 passed (parsers suite; +15 from `share-code.test.ts`).
- `npm run test:worker` — 185/185 passed (workers-runtime suite).
- `npm run test:app` — 168/168 passed (jsdom suite).

Total 449/449, all green. `git diff --stat` against the pre-work tree shows
only the files intended to move (16 modified + 2 new: `share-code.ts` and
its test); no back-compat shim was added.

## Fix round (post-review)

Review verdict: one confirmed Important + one Minor.

- **Important — fixed.** `resolveShareCode` had a primary-window fast path
  that short-circuited on any hit before ever running the wider scan. On
  fall-back night (repeated 1:00-1:59am local hour), two DISTINCT real
  snapshots an hour apart (e.g. 2026-11-01T07:30Z, MDT, and
  2026-11-01T08:30Z, MST) both format to the same code (`20261101-0130`);
  the constant-offset window guess always lands on the FIRST (older) one,
  so the short-circuit returned the older snapshot instead of the newer —
  violating newest-wins. Fixed by removing the primary/fallback split
  entirely: `resolveShareCode` now always runs one bounded window query
  (`[start-2h, start+3h)`, ordered by id DESC), re-derives every candidate
  row's own code via `formatShareCode`, and returns the first (i.e.
  highest-id) exact match. This is still correct and no slower on ordinary
  days (poller cadence is never faster than 5min, so at most one row is
  ever really in range there) and now also correct on both kinds of
  DST-transition day, not just spring-forward.
  - Added regression tests: `test/worker/card-data.test.ts`'s
    `resolveShareCode` describe block gained a fall-back-night case (seeds
    both the older-open and newer-closed snapshot, asserts `resolveShareCode`
    returns the newer id) alongside the existing spring-forward cases;
    `test/worker/card-route.test.ts`'s `/s/{code}` block gained the same
    scenario end-to-end (asserts the served og:title reflects the NEWER
    snapshot's status).
  - Renamed `FALLBACK_BEFORE_MS`/`FALLBACK_AFTER_MS` → `WINDOW_BEFORE_MS`/
    `WINDOW_AFTER_MS` and rewrote `resolveShareCode`'s doc comment now that
    there's only one step, not two.
- **Minor — folded in.** `route.ts`'s immutable-cache-header comment for
  `/og` now states explicitly that the poller's never-faster-than-5min
  cadence (CLAUDE.md hard rule) is what makes two snapshots ever sharing
  one Denver-local minute impossible, i.e. why "newest snapshot naming this
  code" is stable forever once the minute passes.

### Re-verification

- `npx vitest run --config vitest.config.ts test/parsers/share-code.test.ts`
  — 15/15 passed.
- `npx vitest run --config vitest.workers.config.ts test/worker/card-data.test.ts test/worker/card-route.test.ts`
  — 28/28 passed (includes both new fall-back-night regression tests).
- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `npm run test` — 96/96.
- `npm run test:worker` — 187/187 (+2 from the fix round).
- `npm run test:app` — 168/168.

New total: 451/451, all green.

## Commit

`ced4309` (original) and a follow-up fix commit on branch
`worktree-share-codes`:

```
feat(share): datetime share codes (Mountain time) replace raw snapshot ids
fix(share): resolve fall-back-night code collisions to the newest snapshot
```
