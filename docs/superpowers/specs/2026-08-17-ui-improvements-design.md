# Desktop & mobile layout improvements

Date: 2026-08-17
Status: draft for Drew's review
Source handoff: `design/design_handoff_ui_improvements/` (README.md + four `.dc.html` prototypes)

## Goal

Implement the designer's UI round across eight components. The handoff is
high-fidelity — sizes, weights, spacings and copy are final intent — and
introduces **no new design tokens**: every colour maps to an existing Trailhead
token in `src/app/index.css`, so light mode follows automatically from the
dark-mode prototypes.

This spec exists to record the two places the handoff collides with decisions
already in the code, the places its instructions can be implemented more simply
than described, and the ordering constraints across the eight components. Where
the handoff is unambiguous and uncontested, this spec does not restate it — the
README is the authority for exact values and the plan will quote it.

## What the handoff fixes

Verified against the live site and the current code, not taken on faith:

- **Unreadable chart axes.** `TypicalChart` has one fixed `940 × 260` viewBox
  (`TypicalChart.tsx:38-39`) scaled to any container, so 13-unit tick text
  renders around 5px at phone width. The code's own comment already identifies
  the fixed viewBox as the cause and declines to change it as "a larger change
  than adding the axes" — this round is that larger change.
- **The Report sheet's top gets cut off.** `ReportModal.tsx:180` is
  `fixed inset-0 flex items-end justify-center … p-4`, so the sheet is a padded
  flex child: a tall sheet extends past the viewport top and the page behind
  still scrolls.
- **Desktop is narrow.** Home caps at `lg:max-w-[720px]` (`App.tsx:94`) while
  /history caps at `lg:max-w-[1080px]` (`HistoryPage.tsx:136`) — two different
  widths for the same site. Both become 960px.
- Plus: unbalanced drive-time typography, weather tiles that wrap on phones, and
  a /history route picker built from pills.

## Decisions settled with Drew

**The Surface tile always renders, showing an em-dash when there is no
reading.** This reverses an explicit decision in `WeatherStrip.tsx`, whose prop
comment says the tile is *"omitted entirely rather than rendered with an
em-dash: an empty 'Surface —' would imply we checked and the road had no
condition."* Drew chose the fixed 2×2 with the tradeoff stated. Recorded here
because a future reader will find that comment and think the omission was lost
by accident.

**Recommendation inside that decision, for Drew to veto:** render the string
**"No report"** rather than a bare `—`. It preserves the fixed 2×2 exactly —
same tile, same height, same grid — while removing the reading where an
em-dash under `SURFACE` looks like a condition WYDOT reported. One word, no
layout consequence. If Drew prefers the literal em-dash, that is the fallback
and the tile's `aria-label` should then carry "no surface report" so the
distinction survives for screen readers.

## Where the handoff needs amending

### The forecast heading cannot hardcode °F

The handoff says: drop °F from the 5-day card values and state it once as
`5-day forecast · high / low °F`. But the site has a site-wide °F/°C toggle
(`TempUnitToggle`, `useTempUnit`) that governs exactly those values. In Celsius
the cards would read `17 3` beneath a heading claiming °F.

The heading takes the unit from the same `unit` prop the cards use:
`5-day forecast · high / low °F` or `· high / low °C`. Same design, correct in
both states. The intent — say the unit once, not ten times — is preserved.

### The Victor/Driggs filter is a slug-prefix test, not an origin/destination test

The handoff describes the filter as *"eb: filter by origin; wb: filter by
destination — either way 'the route's Idaho side'."* True, but the slug already
encodes it: `seed-routes.ts` builds every slug as
`${idahoTown}-${jacksonSide}-${direction}` — `victor-jackson-eb`,
`driggs-airport-wb`. So the Idaho town is the first slug segment regardless of
direction, and the filter is `slug.startsWith('victor-')`.

This is the same reasoning the existing `sublabelFor` helper already documents:
the slug's segments are a route-pair identity, not a direction. Implementing it
as an origin/destination check would reintroduce a direction dependency the
slug design removed.

### `HourlyStrip`'s `flex: 1 0 62px` needs its scroll container preserved

The handoff asks the hourly card to `flex: 1 0 62px` so twelve cards fill the
960px row, "overflow into the existing horizontal scroll on narrow screens
instead of shrinking." Those two behaviours conflict unless the basis stays
fixed: `flex-grow: 1` with `flex-basis: 62px` and **`flex-shrink: 0`** gives
grow-to-fill on desktop and overflow-then-scroll on phone. The current
implementation is `w-[62px] flex-none`, so this is a change from "never grow" to
"grow but never shrink" — `flex-shrink: 0` is the load-bearing half and must not
be dropped in favour of a plain `flex-1`.

## Ordering constraints

The eight components are mostly independent, with three real dependencies:

1. **`TypicalChart`'s breakpoint switch must land before `HistoryPage`'s
   changes**, because the /history desktop requirement ("both charts use the
   desktop viewBox with axis titles") is expressed in terms of the new props.
2. **`App.tsx`'s 960px cap should land before `DriveTimes`' 2-up grid**, since
   the grid is only worth looking at inside the wider column.
3. **`ForecastStrip` and `HourlyStrip` both gain a precip glyph** (💧 for rain,
   ❄️ when the hour or day's category is snow). That mapping belongs in the
   existing `src/app/weatherGlyphs.ts` beside `glyphFor`, written once and used
   by both, rather than duplicated per component.

Everything else — `WeatherStrip`, `ReportModal` — can land in any order.

## Component-by-component

The handoff README is the authority for exact values; this section records only
what it does not say.

### `App.tsx`
`lg:max-w-[720px]` → `lg:max-w-[960px]`. The existing comment explaining the
single-column-at-every-width decision stays accurate and should not be deleted.

### `DriveTimes.tsx`
Route name to `font-display` 16.5px/700 at `-0.01em`; numeral 22px → 19px.
Per-row "as of" removed; a single "Updated 10:50 PM" moves to the section header.
Desktop `grid-cols-1 lg:grid-cols-2`, all six routes. Phone gains two segmented
controls on one row: Victor|Driggs (slug-prefix filter, above) and → WY|→ ID
(replacing the Flip link on phones only; desktop keeps the link).

Note the existing `deltaCopy` threshold-then-round logic and its comment are
untouched — the handoff changes only where the delta is *displayed*, never how
it is computed. The stale case still shows no delta.

**Hit targets:** the handoff asks for 44px minimum on the segmented controls.
The active segment's `px-4 py-2` at 12.5px does not reach 44px on its own; the
container's `p-[3px]` plus an explicit `min-h-[44px]` on the control is what
gets there.

### `TypicalChart.tsx`
Two viewBoxes switched on `matchMedia('(min-width: 1024px)')`, reusing the
`useIsDesktop` pattern already in `App.tsx`. Desktop `900 × 236`, pad
60/10/14/46, tick 13, x ticks every 3h. Phone `360 × 216`, pad 50/10/14/42,
tick 11, x ticks every 4h. New axis-title props defaulting to
"Time of day (MT)" and "Travel time (min)"; the temp chart passes
"Temperature (°F)".

**The Y-axis title on the temperature chart has the same unit problem as the
forecast heading** — it hardcodes °F while the /history temp chart is subject to
the same toggle. It takes the unit the same way.

Band, median, secondary dashed line, today line, and now-dot/label logic are
explicitly unchanged. `TypicalChart.tsx` is already 401 lines; adding two
viewBox profiles and two titles should extract the profile into a small
`const CHART_PROFILE = { desktop: {...}, phone: {...} }` rather than threading
six more props.

### `HistoryPage.tsx`
Route pills → styled native `<select>` (44px, `appearance:none`, inline-SVG
chevron), with the → WY|→ ID segmented control beside it, at **all** widths.
H1 30px → 24px, H2 30px → 20px at all widths. Page cap
`lg:max-w-[1080px]` → `lg:max-w-[960px]`. Removed copy: the typical-range
caption below the drive chart legend, and the subline under "Summit
temperature". Header link "← Back to live conditions" → "← Live" with
`white-space:nowrap`.

Side switch resets the selection to that side's first route.

### `WeatherStrip.tsx`
Always 2 columns, four fixed-height 64px tiles: Air/Road combined
(`50°F / 51°F`, muted separator), Surface, Gust, Visibility. Label above value,
left-aligned, value `white-space:nowrap`. Gust rounds to whole mph. Section
header: "Summit conditions" left, "WY-22 · 8,431 ft" right.

**The seasonal ordering is dropped.** Current code leads with Road in winter
(`isWinterMonth`) because ice risk matters more than air temp; combining both
into one tile makes the ordering moot, but the handoff fixes Air first
year-round. The `isWinterMonth` helper and its comment become dead and should be
removed rather than left orphaned.

Note the elevation string changes from "WY-22 summit · 8,431 ft" (current, below
the heading) to "WY-22 · 8,431 ft" (handoff, right-aligned on the header row).
8,431 remains the posted highway elevation and must not be reconciled with the
NWS grid cell's 8,474.

### `HourlyStrip.tsx`
`flex: 1 0 62px` per the note above. Precip line gains the shared glyph.

### `ForecastStrip.tsx`
Always `grid-cols-5`, two card layouts on the 1024px breakpoint, nothing
scrolls. Desktop: day label above a row of 44px glyph tile + right column.
Phone: stacked centred, 34px tile, `68° 50°` on one line. °F dropped from
values, stated once in the unit-aware heading.

The existing `sr-only` condition text added last cycle must survive both
layouts — it is the only thing conveying the condition to a screen reader, and
it regressed once already.

### `ReportModal.tsx`
Overlay `fixed inset-0 z-50` dim, unpadded. Sheet `position:fixed`,
`left/right/bottom:0`, `max-height:85dvh`, `max-width:480px` centred on wide
screens, top corners rounded only. Sheet is a flex column: header `flex:none`,
middle `overflow-y:auto flex:1 min-height:0`, footer `flex:none` with a top
border so Send stays visible. Body scroll locked while open, restored on
close/unmount.

**The restore must be unconditional on unmount**, not only on close — the
current component can be unmounted by the `isDesktop` breakpoint flip while
open (`App.tsx` mounts its trigger conditionally), and a body left
`overflow:hidden` freezes the page with no visible cause.

## Non-goals

- No new design tokens, no changes to `src/app/index.css`.
- `WorstDays` / `SeasonCompare` tables unchanged.
- No API, poller, schema, or migration changes. This is entirely `src/app/`.
- The status banner, its four states, and all closure copy are untouched.
- The Search Console indexing items (missing `/history` sitemap entry, absent
  canonicals on `/privacy` and `/embed`) are a separate change and deliberately
  not bundled here.

## Testing

Component tests exist for every file in scope (`test/app/`), so each change has
a place to land. The specific properties worth asserting rather than eyeballing:

- `DriveTimes`: the Victor/Driggs filter returns the three routes for that town
  in **both** directions; the "Updated" timestamp appears once in the header and
  zero times per row; a stale row still shows no delta.
- `TypicalChart`: the desktop and phone profiles produce different viewBoxes and
  tick counts from the same data; axis titles render with the passed values.
- `HistoryPage`: switching side resets the select to that side's first route;
  headings are 24/20 at desktop width too.
- `WeatherStrip`: exactly four tiles at all times, including when
  `surfaceCondition` is null; gust renders whole mph.
- `ForecastStrip` / `HourlyStrip`: the precip glyph is ❄️ for a snow category
  and 💧 otherwise; the `sr-only` condition text survives both layouts.
- `ReportModal`: body scroll is locked on open and restored on unmount as well
  as on close.

**Required manual step:** render both pages at desktop and phone widths and
look at them. Two of the last three rounds shipped a visual defect that a fully
green suite did not catch — a collapsed card and a mis-scaled axis. Per
`docs` note, `wrangler dev` serves a stale `index.html` after a rebuild; if only
the SEO shell renders, stop the server, `rm -rf .wrangler/state/v3/cache
.wrangler/tmp` (not the whole `.wrangler`, which holds the local D1), restart.

Note that narrow `--window-size` renders **crop rather than reflow**, so they
cannot be used to judge the phone layouts. Phone verification needs a real
mobile viewport — the prototypes' own `Mobile Preview.dc.html` uses 390×844
iframes, and the same approach (an iframe at that size, or a browser with a
proper device-metrics override) is what makes the phone breakpoint judgeable.
This matters more this round than usual, since half the handoff is phone-specific.
