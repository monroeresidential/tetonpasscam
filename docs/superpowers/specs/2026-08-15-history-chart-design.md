# Historic drive-time chart + /history page — Design

Date: 2026-08-15. Drew-approved decisions: full mock-2c layout including both tables (with designed empty states); separate `/history` page as its own vite entry PLUS a clickable compact chart on the home page; per-bucket confidence gate backed by a new `sample_count`/`distinct_days` column pair; reason annotations on "Worst days" cut.

## Goal

Build the History screen from `design/design_handoff_tetonpasscam/Teton Pass Cam.dc.html` §2c ("When should you leave?") — today's travel time by hour plotted against a typical p25–p75 band — now that the site has ~1 week of live data. The chart must degrade honestly per-hour rather than drawing an authoritative-looking band over two samples.

## Starting state

`GET /api/history?route=<slug>` already returns `typicals` (median/p25/p75 per route × weekday-class × hour × season) and `today` (every `travel_times` row since Denver midnight). Nothing in the app consumes it: there is no History component, no import of `/api/history`, and `vite.config.ts` builds only `main`/`admin`/`embed`. The 2c mock has never been implemented.

## Data reality this design must respect

The poll cadence is not uniform (`wrangler.toml` `crons`). In MDT (UTC−6):

| Cron | Denver local | Samples/hour/day |
|---|---|---|
| `*/10 11-23` | 5:00 AM – 5:59 PM | ~6 |
| `*/10 0-6` | 6:00 PM – 12:59 AM | ~6 |
| `0 7-10` | 1:00 AM – 4:00 AM | ~1 |

So after one week a mid-day weekday bucket holds ~30 samples while a 4 AM weekend bucket holds ~2 — and 4 AM is the left edge of the mock's x-axis. Per-bucket confidence varies enormously *within a single chart*, which is why the gate is per-bucket rather than a whole-chart caption.

Raw sample count is also misleading on its own: 30 samples at 8 AM is 5 days × 6 polls, and the within-hour spread is not the day-to-day spread a "typical band" claims to show. **The gate therefore keys on `distinct_days`, not `sample_count`.**

Every bucket is currently `season = 'summer'`; winter rows do not exist until December.

## Architecture

### Schema — migration `0002_*.sql`

`0000_polite_blur.sql` / `0001_mysterious_masked_marvel.sql` are frozen (CLAUDE.md §db:generate). Generate a new migration adding to `route_typicals`:

- `sample_count INTEGER` — rows that fed this bucket.
- `distinct_days INTEGER` — distinct Denver-local dates among those rows.

Both nullable. Existing rows get `NULL`; `rebuildTypicals` already does `DELETE` + full rebuild, so all rows carry real values after the next `10 9 * * *` run. **`NULL` is treated by the client as "no band"**, so the pre-rebuild window degrades to median-only rather than to a wrong band.

### `aggregate.ts`

In the existing per-group loop, alongside the `nearestRank` calls: `sampleCount = durations.length`, and `distinctDays = ` size of a `Set` of Denver-local date keys. `denverParts(capturedMs)` is already called per row, so the date key is derived from data on hand — extend the grouping to accumulate a `Set<string>` per group key next to the existing `number[]`. Statement count and the single-`batch` transaction are unchanged.

### Band threshold

One exported tunable constant: `MIN_DISTINCT_DAYS_FOR_BAND = 4`.

Known and accepted consequence: **weekend buckets accrue only 2 distinct days per week**, so weekend bands do not appear until ~2 weeks of history — and the mock's headline example is a Saturday. Weekday bands qualify today. Overnight 1–4 AM buckets gate themselves out naturally (1 sample/day). This is a deliberate honesty trade, not an oversight; the constant is the single lever if Drew wants it looser.

The threshold is **not measured against production**: `wrangler d1 execute --remote` returns `code: 7403` from this environment, so the value is reasoned from the cron table above. Re-check it against real bucket counts before or shortly after launch of this feature.

### API — `GET /api/history?route=<slug>`

Additive only. Each entry in `typicals` gains `sampleCount: number | null` and `distinctDays: number | null`.

A new `summary` object is added, **every field nullable** so the UI drives empty states off real absence rather than sentinel values:

- `worstDays: { date: string; peakSec: number }[] | null` — per-day peak `duration_sec` grouped by Denver-local date, **top 3 descending, scoped to the current season to date** (the mock's "this season"). Grouped in TS (same reason as `rebuildTypicals`: D1/SQLite has no timezone functions), over a `captured_at >= cutoff` query so the scan stays bounded; the cutoff is the later of the current season's start and `TYPICALS_WINDOW_DAYS` ago. `null` when the season has no rows at all; a short list (fewer than 3 days recorded) is returned as-is rather than padded.
- `seasonMedians: { summer: number | null; winter: number | null } | null` — median across all buckets for that season. `winter` stays `null` until December.
- `closureDays: { winter: number | null } | null` — count of distinct Denver-local dates with a `CLOSED` row in `status_snapshots` during the **most recent completed winter**; `null` when no completed winter exists in retention (which is the case now, and will be until spring 2027 — the mock's "Closure days last winter (WYDOT): 11" is sample data, not something we can source yet).

**Reason annotations are cut.** The mock shows "Fri Jan 16 — storm + crash" / "Thu Feb 5 — chain law"; inferring those from `alerts`/`status_snapshots` would be a guess, and hard rule 5 forbids invented display content. Worst-days rows show date + peak only.

### Page & routing

New `src/app/history.html` as a 4th vite input alongside `main`/`admin`/`embed`, with its own React root (`src/app/history.tsx`) and its own SEO `<head>` (`index.html`'s static shell is homepage-specific and edge-injected by `serveHomepage`, which keys on `pathname === '/'`).

No worker change required: `run_worker_first = true` routes every request through `index.ts`, whose final `return env.ASSETS.fetch(req)` hands `/history` to the asset layer, which resolves it to `history.html`. **Verify this empirically against `wrangler dev` rather than trusting it** — `not_found_handling = "404-page"` is in play and the wrangler.toml comments record that this layer has surprised us before.

Check whether the service worker's `navigateFallback` needs `/history` handling, the way `/s/*` needed a denylist entry in the share-cards work.

### Route tabs

The mock draws 3 pills, but `seed-routes.ts` seeds 12 route-directions (6 pairs × eb/wb). Rather than invent a new selection rule, the tabs mirror `DriveTimes` exactly: filter the route list by the current direction (6 pills), and carry the same `'eb' | 'wb'` flip toggle App.tsx already owns. History and Home then never disagree about which routes matter.

### Chart component

One `<TypicalChart>` rendering hand-rolled SVG — no charting library. The mock is already SVG, and a library costs 50–150KB against the Lighthouse ≥90 DoD. A `compact` prop drives the two sizes: full on `/history`, compact on Home wrapped in `<a href="/history">`.

Rendering rules:

- Band `<polygon>` drawn only across contiguous hour runs where `distinctDays >= MIN_DISTINCT_DAYS_FOR_BAND`; below threshold, the median `<polyline>` continues alone. The band must break and resume cleanly rather than interpolating across a withheld hour.
- Today's line stops at the most recent reading, with the annotated "now" dot.
- Caption states what backs the chart and that the band is conditional.
- **All colors from `index.css` tokens** — the mock hardcodes `#faf7f0`/`#eae4d8` and is light-only, but `index.css` ships a full `prefers-color-scheme: dark` token set. Band = `--color-status-open` at low alpha, today's line = `--color-accent`, gridlines = `--color-card-border`, axis labels = `--color-faint`.

### Copy

Derived from data, never hardcoded. The mock's subtitle says "the typical band for a **winter** Saturday" and its takeaway says "on **winter** Saturdays" — it is August and every bucket is `summer`. Season and weekday-class come from `tz.ts`'s `denverParts` applied to the client's current time, and the "The data says: …" takeaway is computed from the typicals actually plotted (and suppressed when the hours it would compare are themselves below threshold).

### Empty states

Both tables render at all times with designed "not enough history yet" states that fill in automatically as data accrues:

- **Worst days** — populated from `summary.worstDays`; empty state notes how long we have been recording.
- **Winter vs summer** — `winter` is `null` until December, so this card reads as a "check back after the first snow" state for the next several months. Accepted; the page never needs re-laying-out later.

## Task split

- **T1 (backend):** migration `0002_*.sql`; `aggregate.ts` `sample_count`/`distinct_days`; `MIN_DISTINCT_DAYS_FOR_BAND` constant in `src/shared/`; `/api/history` `typicals` fields + `summary` object; shared types; worker tests. Ships independently — the API is additive, so nothing breaks while the frontend is unbuilt.
- **T2 (frontend):** `history.html` vite entry + React root + SEO head; `<TypicalChart>`; route tabs + flip; both tables with empty states; compact home-page card linking to `/history`; app tests; `wrangler dev` verification that `/history` actually resolves to `history.html`.

## Testing

- `test/worker/aggregate.test.ts` — `sample_count` / `distinct_days` correctness, specifically the case where one calendar day contributes many samples (count high, distinct-days low), which is the exact shape the gate exists to catch.
- `test/worker/history.test.ts` — `summary` shape; `winter` fields `null` under summer-only data; worst-days grouping lands on Denver-local date boundaries, not UTC.
- `test/app/` — band renders above threshold; band withheld (median-only) below threshold; band breaks and resumes around a sub-threshold hour; both table empty states; season/weekday copy derives from the supplied clock rather than a literal.

## Out of scope

Reason annotations on worst days; a dark-mode-specific chart variant beyond token swaps; per-route deep links (`/history?route=`) unless they fall out for free; widening the overnight cron (considered and declined — ~18 extra Google Routes calls/route/night is a real cost on a paid API, and the gate handles the thin data honestly without it).

## Follow-ups

- Run the bucket-count query against production D1 once `wrangler` is authorized, and re-check `MIN_DISTINCT_DAYS_FOR_BAND` against reality.
- Revisit the "Winter vs summer" card in December when the comparison first becomes real.
