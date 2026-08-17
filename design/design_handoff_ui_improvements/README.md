# Handoff: tetonpasscam.com — Mobile & Desktop UI Improvements

## Overview
A round of UI fixes for tetonpasscam.com, addressing: unbalanced drive-time typography, unreadable chart axes (especially mobile), a hard-to-use /history route picker, weather tiles that wrap and stretch on phones, and a Report-conditions sheet whose top gets cut off. Also widens the desktop layout from 720px to 960px with a 2-up drive-times grid.

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, not production code. The task is to **recreate these designs in the existing codebase** (React + Vite + Tailwind v4, per the repo's established patterns) by modifying the components listed below. All design tokens are the existing Trailhead tokens in `src/app/index.css` — no new tokens are introduced. Prototypes are rendered in dark mode; every color maps to an existing token, so light mode follows automatically.

## Fidelity
**High-fidelity.** Sizes, weights, spacings, and copy are final intent. Sample data (drive times, temps) is illustrative.

## Changes by component

### 1. `App.tsx` — desktop width
- Wrapper cap: `lg:max-w-[720px]` → `lg:max-w-[960px]`.

### 2. `DriveTimes.tsx` — hierarchy + filters
- **Route name promoted**: 14px Atkinson bold → **16.5px Bricolage Grotesque 700, letter-spacing -0.01em** (`font-display`). Numeral demoted: 22px → **19px** extrabold. Sublabel unchanged (11.5px muted).
- **Freshness stated once**: remove per-row "as of 10:50 PM"; add "Updated 10:50 PM" (11.5px muted) in the section header, right side, next to the Flip control. Rows show only the verbal delta (11px bold, delta-pos/delta-neg/muted), or nothing when stale.
- **Desktop (≥1024px): 2-up grid** — `grid grid-cols-1 lg:grid-cols-2 gap-2`, all 6 routes visible (both Idaho towns), no direction filtering change needed beyond current eb/wb.
- **Phone: two segmented controls on one row** below the section header (`flex justify-between`):
  - Left: **Victor | Driggs** — filters the visible routes to the 3 touching that Idaho town. Works in both directions (eb: filter by origin; wb: filter by destination — either way "the route's Idaho side").
  - Right: **→ WY | → ID** — replaces the "⇄ Flip direction" text link on phones (desktop keeps the link). eb = → WY, wb = → ID.
  - Segmented style: container `bg-card border border-card-border rounded-full p-[3px] gap-[3px]`; active segment `bg-btn-bg text-btn-ink rounded-full px-4 py-2 font-bold text-[12.5px]`; inactive `text-muted`, no fill. Min 44px hit targets.

### 3. `TypicalChart.tsx` — readable axes (the big one)
Root cause today: one fixed 940×260 viewBox scales to any container, so 13-unit axis text renders ~5px at phone width.
- **Two viewBox sizes, switched on a real breakpoint** (`matchMedia('(min-width: 1024px)')`, same pattern as `useIsDesktop` in App.tsx):
  - Desktop: 900×236, pad left 60 / right 10 / top 14 / bottom 46, tick font 13.
  - Phone: 360×216, pad left 50 / right 10 / top 14 / bottom 42, tick font 11.
- **X ticks**: every 3 hours on desktop, every 4 hours on phone.
- **Y ticks**: unchanged (min / mid / max through `formatValue`).
- **Axis titles (new)**: centered X title below tick labels ("Time of day (MT)"); rotated −90° Y title at x≈12 ("Travel time (min)" for drive charts, "Temperature (°F)" for the temp chart). 11px, bold, `--color-faint`, letter-spacing 0.04em. Make them props with those defaults.
- Legend, band, median, secondary dashed line, today line, now-dot/label logic all unchanged.

### 4. `HistoryPage.tsx` — controls + type scale
- **Route pills → native `<select>`** (styled): `appearance:none`, card bg, card border, radius 12px, height 44px, Bricolage 700 14px, custom chevron as an inline SVG data-URI background (see prototype), `box-sizing:border-box`. Options = the 6 route pairs for the selected side.
- **Direction → segmented "→ WY | → ID"** next to the select on one row (`flex gap-2`; select `flex-1 min-w-[200px]`). Two Idaho destinations exist from Jackson, so the toggle picks the *side* and the dropdown picks the exact pair. Side switch resets the selection to that side's first route.
- **Type scale**: H1 30px → 24px; "Summit temperature" H2 30px → 20px. Applies at ALL widths — the prototype uses 24/20 on desktop too; do not keep the old 30px desktop headings.
- **Desktop /history (≥1024px)**: page column widens to the same 960px cap as Home (`lg:max-w-[960px]`, replacing `lg:max-w-[1080px]`). The select + → WY/→ ID segmented row is kept on desktop as well (the select replaces the pill tabs everywhere, not just on phones); select stays `flex-1` with the segmented control to its right. Both charts use the desktop viewBox (900×236, 13px ticks, 3-hour x-labels) with axis titles — "Time of day (MT)" / "Travel time (min)" on the drive chart, "Time of day (MT)" / "Temperature (°F)" on the temp chart. The WorstDays / SeasonCompare tables are unchanged by this round.
- **Removed copy**: the typical-range caption paragraph below the drive chart legend, and the subline under "Summit temperature". Legends move below the chart.
- Header: "← Back to live conditions" shortens to "← Live" with `white-space:nowrap` (fixes the wrap in the current mobile header).

### 5. `WeatherStrip.tsx` — fixed-height tiles, 2×2
- Grid: always **2 columns**, four tiles: **Air / Road** (combined: `50°F / 51°F`, separator muted), **Surface**, **Gust**, **Visibility**.
- Tile: **fixed height 64px**, `padding 10px 14px`, left-aligned column: label on top (10.5px uppercase muted, letter-spacing .04em), value below (19px Bricolage 800, `white-space:nowrap`).
- **Gust rounds to whole mph** ("11 mph E", not "11.2 mph E") so it never wraps.
- Section header row: "Summit conditions" left, "WY-22 · 8,431 ft" right (11px muted).

### 6. `HourlyStrip.tsx` — fill the row + precip glyph
- Card: `flex: 1 0 62px` (grow to fill the 960px row; overflow into the existing horizontal scroll on narrow screens instead of shrinking).
- Precip line gets a glyph: **💧 for rain, ❄️ when the hour's forecast category is snow** — `💧 2%`, nowrap.

### 7. `ForecastStrip.tsx` — two responsive layouts, no scroll
Always `grid-cols-5`; two card layouts on the same breakpoint as the chart:
- **Desktop card**: day label top (11.5px bold uppercase muted); below it a row: 44px glyph tile left, right column with `68° 50°` on one line (high 17px Bricolage 800, low 14px regular muted) and `💧 21%` under it (11px muted).
- **Phone card**: stacked & centered — day label (10.5px), 34px glyph tile, **`68° 50°` on one line** (high 13px Bricolage 800, low regular muted), `💧 21%` (10px). Fits 5 across 390px with 6px gaps; nothing scrolls.
- Drop °F from card values; say it once in the section heading: "5-day forecast · high / low °F". Snow days use ❄️ for the precip glyph.

### 8. `ReportModal.tsx` — sheet pinned to the viewport
Root cause today: the sheet is a flex child of a padded `items-end` overlay, so a tall sheet extends past the top and the page behind still scrolls.
- Overlay: `fixed inset-0 z-50` dim; **sheet: `position:fixed; left/right/bottom:0; max-height:85dvh`** (centered `max-width:480px` on wide screens), rounded top corners only.
- Sheet is a **flex column**: header (drag handle + title + close) `flex:none`; **middle section `overflow-y:auto; flex:1; min-height:0`** (type grid, direction pills, note); **footer `flex:none`** with top border — Send button + fine print always visible.
- **Lock body scroll while open** (`document.body.style.overflow = 'hidden'`, restore on close/unmount).
- Content unchanged: 2-col type grid (Other spans 2), WB → Victor / EB → Jackson pills, 140-char note, Send disabled until a type is picked.

## Interactions & Behavior
- Victor/Driggs and → WY/→ ID are independent; the home history teaser card follows the first visible route.
- History side toggle re-populates the select; selection resets to the side's first route.
- Report: pick type → (optional direction/note) → Send → sheet closes, toast "Thanks — report submitted." All existing honeypot/rate-limit/API behavior unchanged.
- Breakpoint for all desktop/phone layout switches: existing `lg` / `useIsDesktop` (1024px).

## Design Tokens (existing, from `src/app/index.css` — no changes)
Dark values shown as used in the prototypes: page `#211d17`, card `#2b2620`, border `#3a342b`, ink `#f0ebe1`, muted `#a39880`, faint `#6e6553`, accent `oklch(0.75 0.11 60)`, status-open `oklch(0.45 0.11 150)`, delta-pos `oklch(0.72 0.12 150)`, delta-neg `oklch(0.72 0.14 30)`, btn `#f0ebe1`/`#211d17`, icon-tile `oklch(0.34 0.03 60)`. Fonts: Bricolage Grotesque (display), Atkinson Hyperlegible (body). Radii: cards 14px, pills 999px, chart cards 16px.

## Assets
None new. Fonts and the header icon are already in the repo (`public/fonts/`, `public/icons/`).

## Files
- `Teton Pass Home v2.dc.html` — home prototype (interactive: filters, flip, report sheet)
- `Teton Pass History v2.dc.html` — /history prototype (interactive: select, side toggle)
- `Mobile Preview.dc.html` — both pages in 390×844 iframes for phone-breakpoint review
- `Mobile UI Improvements.dc.html` — the exploration doc (options 1a–1j with "current" recreations); chosen: 1a, 1c, 1e (modified to → WY/→ ID), 1f (2×2, Air/Road combined), 1h, 1j
- `fonts/`, `icons/` — copied from the repo so the prototypes render standalone
