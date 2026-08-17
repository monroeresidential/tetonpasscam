# Desktop & Mobile Layout Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the designer's UI round across seven task groups — wider desktop column, restructured drive times, readable chart axes, a native-select history picker, fixed-height weather tiles, filled forecast rows, and a viewport-pinned report sheet.

**Architecture:** Entirely `src/app/`. No API, poller, schema, or migration changes. All layout switches use the existing 1024px `lg` breakpoint and the `useIsDesktop` pattern already in `App.tsx`. No new design tokens — every colour is an existing Trailhead token.

**Tech Stack:** React 19 + Vite, Tailwind v4 (CSS-first tokens in `src/app/index.css`), vitest + jsdom (`npm run test:app`).

**Spec:** `docs/superpowers/specs/2026-08-17-ui-improvements-design.md`
**Handoff (authority for exact values):** `design/design_handoff_ui_improvements/README.md` plus the four `.dc.html` prototypes.

## Global Constraints

- **No new design tokens.** Every colour maps to an existing token in `src/app/index.css`. Prototypes are dark-mode; light mode follows automatically. Never hardcode a hex from a prototype — map it: `#211d17`→`page`, `#2b2620`→`card`, `#3a342b`→`card-border`, `#f0ebe1`→`ink`/`btn-bg`, `#a39880`→`muted`, `#6e6553`→`faint`, `oklch(0.75 0.11 60)`→`accent`, `oklch(0.34 0.03 60)`→`icon-tile`, btn ink `#211d17`→`btn-ink`.
- **All layout switches use 1024px** — Tailwind `lg:` for CSS, `useIsDesktop`/`matchMedia('(min-width: 1024px)')` for JS. Do not introduce a second breakpoint.
- **Temperature units are never hardcoded.** The site has a `°F`/`°C` toggle (`useTempUnit`) governing every temperature. Any label naming a unit takes it from the same `unit` prop its values use.
- **Absence is `—` / nothing, never `0`.** Existing behaviour throughout; unchanged.
- **The status banner and all closure copy are untouched.** No task in this plan goes near `StatusBanner`, `resolveStatus`, or any OPEN/RESTRICTED/CLOSED string.
- **`min-h-[44px]` on every new tap target.** The prototype's `padding:8px 16px` at 12.5px yields ~34px on its own; the container's `p-[3px]` plus an explicit min-height is what reaches 44.
- This repo **typechecks nowhere** (`build` is `vite build`, esbuild only; no eslint). A green suite is not evidence of type correctness.
- Baseline before this plan: `npm run test` 138, `npm run test:worker` 282, `npm run test:app` 299.

## Rulings recorded before implementation

**R1 — Desktop drive-times grid uses `lg:grid-cols-2`, not the prototype's `auto-fit`.** The README says `grid grid-cols-1 lg:grid-cols-2 gap-2`; the prototype uses `repeat(auto-fit,minmax(min(420px,100%),1fr))`. Both give 2-up at 960px. Taking the README's explicit breakpoint because `auto-fit` at `minmax(420px)` flips to two columns at roughly 848px — *below* the 1024px breakpoint every other switch in this round uses — creating a third layout state between 848 and 1024 that nothing else accounts for. Cost if wrong: the grid goes 2-up slightly later on tablet-width windows.

**R2 — Surface tile renders "No report" rather than a bare em-dash.** Drew chose an always-present Surface tile, reversing a code comment that omitted it to avoid implying "we checked and the road had no condition". "No report" keeps the fixed 2×2 identically while removing that reading. If Drew prefers the literal `—`, the tile's `aria-label` must carry "no surface report".

**R3 — The Victor/Driggs filter is a slug-prefix test.** `seed-routes.ts` builds every slug as `${idahoTown}-${jacksonSide}-${direction}`, so the Idaho town is the first segment regardless of direction: `slug.startsWith('victor-')`. Same reasoning `sublabelFor` already documents. An origin/destination check would reintroduce a direction dependency the slug design removed.

---

## File Structure

| File | Change |
| --- | --- |
| `src/app/App.tsx` | **modify** — 960px cap; pass `unit` down where new labels need it |
| `src/app/weatherGlyphs.ts` | **modify** — add `precipGlyphFor(category)` shared by both strips |
| `src/app/components/WeatherStrip.tsx` | **modify** — fixed-height 2×2, four tiles, Air/Road combined |
| `src/app/components/DriveTimes.tsx` | **modify** — typography, header freshness, 2-up grid, two segmented controls |
| `src/app/components/Segmented.tsx` | **new** — the segmented control, used by DriveTimes and HistoryPage |
| `src/app/components/TypicalChart.tsx` | **modify** — two viewBox profiles, axis titles |
| `src/app/HistoryPage.tsx` | **modify** — native select + segmented, type scale, 960px cap, removed copy |
| `src/app/components/ForecastStrip.tsx` | **modify** — two card layouts, precip glyph, unit-aware heading |
| `src/app/components/HourlyStrip.tsx` | **modify** — `flex: 1 0 62px`, precip glyph |
| `src/app/components/ReportModal.tsx` | **modify** — fixed sheet, flex column, body-scroll lock |

`Segmented.tsx` is extracted rather than duplicated: the same control appears in `DriveTimes` (twice) and `HistoryPage` (once), with identical markup and three different label pairs. Three call sites is past the point where copying is cheaper.

---

## Task 1: Foundations — desktop width + shared precip glyph

**Files:**
- Modify: `src/app/App.tsx`, `src/app/weatherGlyphs.ts`
- Test: `test/app/weatherGlyphs.test.ts` (append)

**Interfaces:**
- Produces: `precipGlyphFor(category: ForecastCategory): string`

Both later strips need the glyph and every later task benefits from the wider column, so this lands first and alone.

- [ ] **Step 1: Write the failing test**

Append to `test/app/weatherGlyphs.test.ts`:

```ts
import { precipGlyphFor } from '../../src/app/weatherGlyphs';

describe('precipGlyphFor', () => {
  it('uses a snowflake for snow and a droplet for everything else', () => {
    expect(precipGlyphFor('snow')).toBe('❄️');
    expect(precipGlyphFor('rain')).toBe('💧');
    expect(precipGlyphFor('clear')).toBe('💧');
    expect(precipGlyphFor('thunderstorm')).toBe('💧');
  });

  it('treats mixed precipitation as snow -- the hazard, not the average', () => {
    // `mixed` is rain AND snow. On a mountain pass the snowflake is the
    // half a driver needs to see, matching the severity bias the daily
    // rollup's tie-break already applies.
    expect(precipGlyphFor('mixed')).toBe('❄️');
  });

  it('carries emoji presentation on both glyphs', () => {
    for (const g of [precipGlyphFor('snow'), precipGlyphFor('rain')]) {
      const base = String.fromCodePoint(g.codePointAt(0)!);
      expect(g.includes('️')).toBe(!/\p{Emoji_Presentation}/u.test(base));
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app -- weatherGlyphs`
Expected: FAIL — `precipGlyphFor is not a function`.

- [ ] **Step 3: Add the helper**

In `src/app/weatherGlyphs.ts`, after `glyphFor`:

```ts
/**
 * The glyph prefixing a precipitation percentage. Distinct from
 * `WEATHER_GLYPH`: that answers "what is the weather", this answers "what
 * would fall", so it collapses eight categories to two.
 *
 * `mixed` takes the snowflake rather than the droplet -- it is rain AND
 * snow, and on a pass the frozen half is the one a driver needs to see.
 * That is the same severity bias `rollupDaily`'s tie-break already applies.
 */
export function precipGlyphFor(category: ForecastCategory): string {
  return category === 'snow' || category === 'mixed' ? '❄️' : '💧';
}
```

- [ ] **Step 4: Widen the desktop column**

In `src/app/App.tsx`, change the wrapper's cap from `lg:max-w-[720px]` to `lg:max-w-[960px]`. Leave the surrounding comment explaining the single-column-at-every-width decision — it stays accurate.

- [ ] **Step 5: Run the app suite**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/weatherGlyphs.ts test/app/weatherGlyphs.test.ts
git commit -m "feat(ui): widen desktop to 960px, add the shared precip glyph"
```

---

## Task 2: `Segmented` control

**Files:**
- Create: `src/app/components/Segmented.tsx`
- Test: `test/app/Segmented.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface SegmentedOption<T extends string> { value: T; label: string }
export default function Segmented<T extends string>(props: {
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}): JSX.Element;
```

Extracted first because `DriveTimes` (Task 3) and `HistoryPage` (Task 5) both consume it.

- [ ] **Step 1: Write the failing test**

Create `test/app/Segmented.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Segmented from '../../src/app/components/Segmented';

const OPTIONS = [
  { value: 'victor', label: 'Victor' },
  { value: 'driggs', label: 'Driggs' },
] as const;

describe('Segmented', () => {
  it('exposes the selection as pressed state, not just styling', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    expect(screen.getByRole('button', { name: 'Victor' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Driggs' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('groups the two buttons under the given label', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    expect(screen.getByRole('group', { name: 'Idaho town' })).toBeInTheDocument();
  });

  it('reports the newly picked value', async () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="victor" onChange={onChange} ariaLabel="Idaho town" />);
    await userEvent.click(screen.getByRole('button', { name: 'Driggs' }));
    expect(onChange).toHaveBeenCalledWith('driggs');
  });

  it('does not fire onChange when the active segment is re-clicked', () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="victor" onChange={onChange} ariaLabel="Idaho town" />);
    screen.getByRole('button', { name: 'Victor' }).click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives every segment a 44px minimum tap target', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    // The prototype's padding alone yields ~34px; the min-height is what
    // reaches the 44px the handoff requires.
    for (const name of ['Victor', 'Driggs']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:app -- Segmented`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/app/components/Segmented.tsx`:

```tsx
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Two-option pill toggle, used for the Idaho-town filter and the direction
 * switch on Home and the direction switch on /history. Extracted rather than
 * copied: three call sites with identical markup and different label pairs.
 *
 * Buttons with `aria-pressed` rather than radios: the visual is a pair of
 * pills, the behaviour is "pick one", and `aria-pressed` conveys that without
 * the label/fieldset scaffolding a radio group needs. `role="group"` carries
 * the pair's own name.
 *
 * Tokens map from the prototype: container `card`/`card-border`, active
 * segment `btn-bg`/`btn-ink`, inactive `muted` on no fill.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="bg-card border-card-border inline-flex gap-[3px] rounded-full border p-[3px]"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            // Re-clicking the active segment is a no-op rather than a
            // toggle: these are filters with no "neither" state.
            onClick={active ? undefined : () => onChange(option.value)}
            className={`min-h-[44px] rounded-full px-4 py-2 text-[12.5px] font-bold ${
              active ? 'bg-btn-bg text-btn-ink' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:app -- Segmented`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Segmented.tsx test/app/Segmented.test.tsx
git commit -m "feat(ui): extract the segmented pill control

Three call sites across Home and /history with identical markup."
```

---

## Task 3: `WeatherStrip` — fixed-height 2×2

**Files:**
- Modify: `src/app/components/WeatherStrip.tsx`
- Test: `test/app/WeatherStrip.test.tsx`

- [ ] **Step 1: Write the failing tests**

Amend `test/app/WeatherStrip.test.tsx` — replace the existing tile-count and ordering tests (the seasonal ordering no longer exists) and add:

```tsx
  it('always renders exactly four tiles, including when surface is absent', () => {
    render(<WeatherStrip weather={reading} surfaceCondition="Dry" />);
    expect(screen.getAllByTestId('weather-tile')).toHaveLength(4);

    render(<WeatherStrip weather={reading} surfaceCondition={null} />);
    expect(screen.getAllByTestId('weather-tile')).toHaveLength(4);
  });

  it('combines air and road into one tile', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText('Air / Road')).toBeInTheDocument();
    expect(screen.getByText(/28°F\s*\/\s*22°F/)).toBeInTheDocument();
  });

  it('says "No report" rather than an em-dash when there is no surface reading', () => {
    // Ruling R2: a bare em-dash under SURFACE reads as a condition WYDOT
    // reported. "No report" keeps the fixed 2x2 and removes that reading.
    render(<WeatherStrip weather={reading} surfaceCondition={null} />);
    expect(screen.getByText('No report')).toBeInTheDocument();
  });

  it('rounds gust to whole mph so it cannot wrap', () => {
    render(<WeatherStrip weather={{ ...reading, windGustMph: 11.2 }} />);
    expect(screen.getByText('11 mph W')).toBeInTheDocument();
    expect(screen.queryByText(/11\.2/)).not.toBeInTheDocument();
  });

  it('puts the elevation on the header row, not under the heading', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText('WY-22 · 8,431 ft')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- WeatherStrip`
Expected: FAIL on the tile count and the combined label.

- [ ] **Step 3: Rewrite the tile set**

In `src/app/components/WeatherStrip.tsx`:

- Delete `isWinterMonth` and its comment entirely — combining Air and Road makes the seasonal ordering moot, and leaving the helper orphaned invites someone to wire it back up.
- Delete the `wide` field from `Tile` and the `gridCols` calculation; the grid is always `grid-cols-2`.
- Build exactly four tiles, in order: Air / Road, Surface, Gust, Visibility.
- `gustValue` rounds: `Math.round(weather.windGustMph)`.
- Surface value is `surfaceCondition ?? 'No report'`.
- Each tile: `data-testid="weather-tile"`, fixed `h-16`, `px-3.5 py-2.5`, left-aligned column — label above (`text-[10.5px] uppercase tracking-[0.04em] text-muted`), value below (`font-display text-[19px] font-extrabold whitespace-nowrap`).
- Header row becomes `flex items-baseline justify-between`: the `<h2>` left, `WY-22 · 8,431 ft` right at `text-[11px] text-muted`. The `SUMMIT_ELEVATION_LABEL` constant's comment about 8,431 vs 8,474 stays — the number is still deliberate.

The Air/Road value composes as `{air} / {road}` with the separator in `text-muted`, each side falling back to `—` independently.

- [ ] **Step 4: Run the tests**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/WeatherStrip.tsx test/app/WeatherStrip.test.tsx
git commit -m "feat(ui): fixed-height 2x2 weather tiles

Air and Road combine into one tile, which retires the seasonal
road-first ordering. Surface now always renders, saying 'No report'
when WYDOT sent none rather than an em-dash that reads as a reading."
```

---

## Task 4: `DriveTimes` — hierarchy, header freshness, 2-up grid, filters

**Files:**
- Modify: `src/app/components/DriveTimes.tsx`, `src/app/App.tsx`
- Test: `test/app/DriveTimes.test.tsx`, `test/app/App.test.tsx`

**Interfaces:**
- Consumes: `Segmented` (Task 2)
- Produces: `DriveTimes` gains `town`/`onTownChange` props; `App` owns the town state

- [ ] **Step 1: Write the failing tests**

Add to `test/app/DriveTimes.test.tsx`:

```tsx
  it('filters to the chosen Idaho town in BOTH directions', () => {
    // Ruling R3: the Idaho town is the slug's first segment regardless of
    // direction, so the same filter works eastbound and westbound.
    const { rerender } = render(
      <DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />,
    );
    expect(screen.getAllByTestId('drive-row')).toHaveLength(3);
    expect(screen.queryByText(/Driggs/)).not.toBeInTheDocument();

    rerender(
      <DriveTimes travelTimes={ALL_TWELVE} direction="wb" town="victor" onTownChange={() => {}} onFlip={() => {}} />,
    );
    expect(screen.getAllByTestId('drive-row')).toHaveLength(3);
    expect(screen.queryByText(/Driggs/)).not.toBeInTheDocument();
  });

  it('states freshness once in the header, never per row', () => {
    render(<DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.getAllByText(/^Updated /)).toHaveLength(1);
    expect(screen.queryByText(/as of /)).not.toBeInTheDocument();
  });

  it('shows no delta for a stale row', () => {
    const stale = [{ ...ALL_TWELVE[0], stale: true }];
    render(<DriveTimes travelTimes={stale} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.queryByText(/than usual|about usual/)).not.toBeInTheDocument();
  });

  it('promotes the route name to the display face and demotes the numeral', () => {
    render(<DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.getByText('Victor → Jackson')).toHaveClass('font-display');
    expect(screen.getByText(/^38 min$/)).toHaveClass('text-[19px]');
  });
```

`ALL_TWELVE` must cover all twelve seeded route-directions, or the town filter's "3 of 6" assertion proves nothing. Add to the top of the file:

```tsx
// All twelve seeded route-directions. The filter test asserts 3 of 6 per
// direction, so a shorter fixture would pass for the wrong reason.
const PREFIXES = [
  ['victor-jackson', 'Victor → Jackson', 'Jackson → Victor'],
  ['driggs-jackson', 'Driggs → Jackson', 'Jackson → Driggs'],
  ['victor-tetonvillage', 'Victor → Teton Village', 'Teton Village → Victor'],
  ['driggs-tetonvillage', 'Driggs → Teton Village', 'Teton Village → Driggs'],
  ['victor-airport', 'Victor → Airport', 'Airport → Victor'],
  ['driggs-airport', 'Driggs → Airport', 'Airport → Driggs'],
] as const;

const ALL_TWELVE: ApiStatus['travelTimes'] = PREFIXES.flatMap(([prefix, ebName, wbName]) => [
  {
    slug: `${prefix}-eb`,
    name: ebName,
    durationSec: 2280,
    typicalSec: 2280,
    capturedAt: '2026-08-16T22:50:00.000Z',
    stale: false,
  },
  {
    slug: `${prefix}-wb`,
    name: wbName,
    durationSec: 2160,
    typicalSec: 2160,
    capturedAt: '2026-08-16T22:50:00.000Z',
    stale: false,
  },
]);
```

Note `durationSec: 2280` is 38 minutes, which is what the `/^38 min$/` typography assertion matches.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- DriveTimes`
Expected: FAIL — `town` is not a prop; rows still carry "as of".

- [ ] **Step 3: Implement**

- `idahoTownOf(slug)`: `slug.startsWith('victor-') ? 'victor' : slug.startsWith('driggs-') ? 'driggs' : null`, with a comment citing the slug shape from `seed-routes.ts` and why this is direction-independent (Ruling R3).
- Rows filter on direction **and** town.
- `DriveTimeCard`: name → `font-display text-[16.5px] font-bold tracking-[-0.01em]`; numeral → `text-[19px]`; drop the `as of` branch so a stale row renders the numeral muted and nothing beneath it; add `data-testid="drive-row"`.
- Delete `formatAsOf` from the card and use it once in the header, on the newest `capturedAt` across the visible rows.
- Header right side: desktop shows `Updated 10:50 PM · ⇄ Flip direction` (the prototype keeps both, separated by `·`); phone shows `Updated 10:50 PM` alone.
- Below the header on phones only (`lg:hidden`), a `flex flex-wrap justify-between gap-2` row with two `Segmented`s: Victor|Driggs and `→ WY`|`→ ID` (eb = → WY, wb = → ID).
- Rows grid: `grid grid-cols-1 lg:grid-cols-2 gap-2` (Ruling R1).
- `App.tsx` owns `town` state (`useState<'victor'|'driggs'>('victor')`) and passes it down. Add `hourly`-style `town` threading to the `HomeHistoryCard` selection so the teaser follows the first visible route, per the handoff's Interactions note.

- [ ] **Step 4: Run the tests**

Run: `npm run test:app`
Expected: PASS. Add `town: 'victor'` wherever `App.test.tsx` renders `DriveTimes` directly, if it does.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/DriveTimes.tsx src/app/App.tsx test/app/DriveTimes.test.tsx test/app/App.test.tsx
git commit -m "feat(ui): drive-times hierarchy, header freshness, 2-up grid, town filter"
```

---

## Task 5: `TypicalChart` — two viewBox profiles + axis titles

**Files:**
- Modify: `src/app/components/TypicalChart.tsx`
- Test: `test/app/TypicalChart.test.tsx`

**Interfaces:**
- Produces: `TypicalChart` gains `xAxisTitle?: string` and `yAxisTitle?: string`

This is the task the handoff calls "the big one". `TypicalChart.tsx` is already 401 lines; extract a profile object rather than threading six more constants.

- [ ] **Step 1: Write the failing tests**

Add to `test/app/TypicalChart.test.tsx`:

```tsx
  it('uses a taller, wider viewBox with larger ticks on desktop', () => {
    setMatchMedia(true); // (min-width: 1024px) matches
    const { container } = render(<TypicalChart {...BASE_PROPS} />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 900 236');
  });

  it('uses the phone viewBox below the breakpoint', () => {
    setMatchMedia(false);
    const { container } = render(<TypicalChart {...BASE_PROPS} />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 360 216');
  });

  it('labels fewer x ticks on phone than on desktop', () => {
    setMatchMedia(true);
    const { container: desktop } = render(<TypicalChart {...BASE_PROPS} />);
    setMatchMedia(false);
    const { container: phone } = render(<TypicalChart {...BASE_PROPS} />);
    const count = (c: HTMLElement) => c.querySelectorAll('[data-testid="x-tick"]').length;
    expect(count(desktop)).toBeGreaterThan(count(phone));
  });

  it('renders the axis titles it is given', () => {
    setMatchMedia(true);
    render(<TypicalChart {...BASE_PROPS} yAxisTitle="Temperature (°C)" />);
    expect(screen.getByText('Time of day (MT)')).toBeInTheDocument();
    expect(screen.getByText('Temperature (°C)')).toBeInTheDocument();
  });
```

**This task owns the shared `matchMedia` stub**, because Task 7 imports it too. jsdom does not implement `matchMedia`, and `useIsDesktop` defaults to `false` when it is absent — so an unstubbed test silently gets the phone profile, which is why the desktop assertions need the stub to mean anything.

Create `test/app/matchMedia.ts`:

```ts
/**
 * jsdom implements no `matchMedia`, and `useIsDesktop` treats its absence as
 * "not desktop" -- so without this stub every test silently exercises the
 * phone branch and a desktop assertion passes for the wrong reason.
 *
 * Call in the test body BEFORE render; `useIsDesktop` reads the query in a
 * `useState` initializer, so stubbing after mount has no effect.
 */
export function setMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
```

Import it as `import { setMatchMedia } from './matchMedia';`.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- TypicalChart`
Expected: FAIL — viewBox is `0 0 940 260`.

- [ ] **Step 3: Implement**

Replace the `VB_W`/`VB_H`/pad/tick-font constants with:

```ts
/**
 * Two complete geometry profiles rather than one scaled viewBox. The old
 * single 940x260 box scaled to any container, so 13-unit tick text rendered
 * around 5px at phone width -- the root cause this replaces, and the one the
 * file's previous comment declined to take on.
 *
 * Switched on a real 1024px media query (the `useIsDesktop` pattern from
 * App.tsx), not on CSS, because the tick COUNT changes too and that is a
 * render decision, not a style.
 */
const CHART_PROFILE = {
  desktop: { w: 900, h: 236, padL: 60, padR: 10, padT: 14, padB: 46, tickFont: 13, xTickHours: 3 },
  phone: { w: 360, h: 216, padL: 50, padR: 10, padT: 14, padB: 42, tickFont: 11, xTickHours: 4 },
} as const;
```

Read the profile from a local `useIsDesktop()` (extract the existing hook from `App.tsx` into `src/app/useIsDesktop.ts` and import it in both places rather than copying it). Every existing geometry reference switches to `profile.*`.

Add the two axis titles: X centred below the tick labels, Y rotated `-90` at `x≈12`. Both `text-[11px] font-bold` in `--color-faint` with `letter-spacing: 0.04em`. Props default to `'Time of day (MT)'` and `'Travel time (min)'`.

Tag x tick labels `data-testid="x-tick"` so the count is assertable.

Band, median, secondary dashed line, today line and the now-dot/label logic are explicitly unchanged — if a diff line touches them, it is a mistake.

- [ ] **Step 4: Run the tests**

Run: `npm run test:app`
Expected: PASS, including the existing chart tests (`historyChart.test.ts`, `TempChart.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add src/app/components/TypicalChart.tsx src/app/useIsDesktop.ts src/app/App.tsx test/app/
git commit -m "feat(ui): breakpoint-switched chart geometry + axis titles

One fixed 940-unit viewBox scaled to any container, so tick text rendered
around 5px on a phone. Two profiles switched on a real media query."
```

---

## Task 6: `HistoryPage` — select + segmented, type scale, width, removed copy

**Files:**
- Modify: `src/app/HistoryPage.tsx`
- Test: `test/app/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `Segmented` (Task 2), `TypicalChart`'s axis-title props (Task 5)

- [ ] **Step 1: Write the failing tests**

Add to `test/app/HistoryPage.test.tsx`:

```tsx
  it('picks the route with a select rather than pills, at every width', () => {
    renderHistory();
    expect(screen.getByRole('combobox', { name: /route/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('resets the selection to the side\'s first route when the side flips', async () => {
    renderHistory();
    const select = screen.getByRole('combobox', { name: /route/i });
    await userEvent.selectOptions(select, screen.getByRole('option', { name: /Airport/ }));
    await userEvent.click(screen.getByRole('button', { name: '→ ID' }));
    // Side switch re-populates the options; selection returns to the first.
    expect((select as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('passes unit-aware axis titles to both charts', () => {
    renderHistory();
    expect(screen.getByText('Travel time (min)')).toBeInTheDocument();
    expect(screen.getByText('Temperature (°F)')).toBeInTheDocument();
  });

  it('drops the removed copy', () => {
    renderHistory();
    expect(screen.queryByText(/typical range/i)).not.toBeInTheDocument();
  });

  it('shortens the back link so it cannot wrap', () => {
    renderHistory();
    expect(screen.getByRole('link', { name: '← Live' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- HistoryPage`
Expected: FAIL — no combobox; the back link still reads "← Back to live conditions".

- [ ] **Step 3: Implement**

- Replace the pill tabs with a styled native `<select>`: `appearance-none`, `bg-card`, `border-card-border`, `rounded-[12px]`, `h-11`, `font-display text-sm font-bold`, `box-border`, and the chevron as an inline-SVG data-URI background. Give it an accessible name (`aria-label="Route"` or a visually-hidden `<label>`).
- Beside it, `Segmented` for `→ WY`|`→ ID`. Row is `flex gap-2`; the select is `flex-1 min-w-[200px]`.
- Side switch resets the selection to that side's first route.
- H1 `text-[24px]`, "Summit temperature" H2 `text-[20px]`, at **all** widths — delete the `lg:` variants that currently push them to 30px.
- Page cap `lg:max-w-[1080px]` → `lg:max-w-[960px]`.
- Remove the typical-range caption below the drive chart legend and the subline under "Summit temperature". Legends move below their chart.
- Back link → `← Live` with `whitespace-nowrap`.
- Pass axis titles: drive chart `yAxisTitle="Travel time (min)"`; temp chart `yAxisTitle={`Temperature (°${unit})`}` — **unit-aware**, since this page owns a `TempUnitToggle` and passes `formatTemp(v, unit)` into the same chart's tick formatter.

- [ ] **Step 4: Run the tests**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/HistoryPage.tsx test/app/HistoryPage.test.tsx
git commit -m "feat(ui): /history select + segmented controls, tighter type scale"
```

---

## Task 7: `ForecastStrip` + `HourlyStrip` — fill the rows, precip glyphs

**Files:**
- Modify: `src/app/components/ForecastStrip.tsx`, `src/app/components/HourlyStrip.tsx`
- Test: `test/app/ForecastStrip.test.tsx`, `test/app/HourlyStrip.test.tsx`

**Interfaces:**
- Consumes: `precipGlyphFor` (Task 1), `useIsDesktop` (Task 5)

- [ ] **Step 1: Write the failing tests**

Add to `test/app/ForecastStrip.test.tsx`:

```tsx
  it('states the unit once in the heading, and follows the toggle', () => {
    const { rerender } = render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.getByRole('heading', { name: '5-day forecast · high / low °F' })).toBeInTheDocument();
    rerender(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="C" />);
    // The handoff hardcodes °F; the site has a toggle, so the heading takes
    // the unit or it contradicts its own values.
    expect(screen.getByRole('heading', { name: '5-day forecast · high / low °C' })).toBeInTheDocument();
  });

  it('drops the unit from the card values', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.queryByText(/62°F/)).not.toBeInTheDocument();
    expect(screen.getByText(/62°/)).toBeInTheDocument();
  });

  it('uses a snowflake precip glyph on snow days and a droplet otherwise', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByText('❄️ 70%')).toBeInTheDocument();
    expect(screen.getByText('💧 20%')).toBeInTheDocument();
  });

  it('keeps the sr-only condition text in both layouts', () => {
    setMatchMedia(true);
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByText('Snow')).toBeInTheDocument();
    setMatchMedia(false);
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getAllByText('Snow').length).toBeGreaterThan(0);
  });
```

Add to `test/app/HourlyStrip.test.tsx`:

```tsx
  it('grows to fill the row but never shrinks below its basis', () => {
    render(<HourlyStrip hourly={TWELVE} />);
    // `flex-shrink: 0` is the load-bearing half: grow-to-fill on desktop,
    // overflow-then-scroll on phone. A plain `flex-1` would shrink the
    // cards to unreadable slivers instead of scrolling.
    const card = screen.getAllByTestId('hour-card')[0];
    expect(card).toHaveClass('grow');
    expect(card).toHaveClass('shrink-0');
    expect(card).toHaveClass('basis-[62px]');
  });

  it('prefixes precip with a snowflake for a snow hour', () => {
    render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00', category: 'snow', precipPct: 80 })]} />);
    expect(screen.getByText('❄️ 80%')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- ForecastStrip HourlyStrip`
Expected: FAIL on the heading text and the glyph prefixes.

- [ ] **Step 3: Implement**

`ForecastStrip`: heading becomes `5-day forecast · high / low °{unit}`. Cards keep `grid-cols-5` and gain two layouts on `useIsDesktop()` — desktop: day label above a row of 44px tile + right column (`68° 50°` on one line, high `text-[17px]` Bricolage 800, low `text-[14px]` muted regular; `💧 21%` beneath at `text-[11px]`). Phone: stacked centred, `text-[10.5px]` label, 34px tile, `68° 50°` (high `text-[13px]`), `text-[10px]` precip. Values lose the unit — format the number without the degree suffix and append a bare `°`. **The `sr-only` condition span must appear in both layouts.**

`HourlyStrip`: card className `grow shrink-0 basis-[62px]` replacing `w-[62px] flex-none`; precip line becomes `{precipGlyphFor(h.category)} {h.precipPct}%` with `whitespace-nowrap`, still `—` when null.

- [ ] **Step 4: Run the full app suite**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ForecastStrip.tsx src/app/components/HourlyStrip.tsx test/app/
git commit -m "feat(ui): fill the forecast rows, add precip glyphs

Heading takes the temperature unit rather than hardcoding °F -- the
handoff states it once, but the site has a °F/°C toggle."
```

---

## Task 8: `ReportModal` — sheet pinned to the viewport

**Files:**
- Modify: `src/app/components/ReportModal.tsx`
- Test: `test/app/ReportModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `test/app/ReportModal.test.tsx`:

```tsx
  it('locks body scroll while open and restores it on close', async () => {
    const { rerender } = render(<ReportModal open={false} onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('');

    rerender(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<ReportModal open={false} onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on UNMOUNT, not only on close', () => {
    // App.tsx mounts this component's trigger conditionally on the desktop
    // breakpoint, so a resize can unmount it while open. A body left
    // `overflow: hidden` freezes the page with no visible cause.
    const { unmount } = render(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the footer reachable by scrolling only the middle section', () => {
    render(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    const scroller = screen.getByTestId('sheet-scroll');
    expect(scroller).toHaveClass('overflow-y-auto');
    expect(scroller).toHaveClass('min-h-0');
    // The Send button lives outside the scroller, so it is always visible.
    expect(scroller).not.toContainElement(screen.getByRole('button', { name: /send/i }));
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- ReportModal`
Expected: FAIL — body overflow is never set; there is no `sheet-scroll`.

- [ ] **Step 3: Implement**

- Overlay: `fixed inset-0 z-50 bg-black/50` — remove `flex items-end justify-center p-4 sm:items-center`. The padding is the root cause: it makes the sheet a padded flex child that overflows the viewport top.
- Sheet: `fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[480px] flex-col rounded-t-[16px]` with the card background.
- Header (`flex-none`): drag handle, title, close.
- Middle (`data-testid="sheet-scroll"`, `min-h-0 flex-1 overflow-y-auto`): type grid, direction pills, note.
- Footer (`flex-none border-t border-card-border`): Send + fine print.
- Body-scroll lock in a `useEffect` keyed on `open`, whose cleanup **always** restores — so unmount-while-open restores too:

```tsx
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
```

Restoring the *previous* value rather than `''` matters if anything else ever locks scroll.

Content is otherwise unchanged: 2-col type grid with Other spanning 2, WB → Victor / EB → Jackson pills, 140-char note, Send disabled until a type is picked. All honeypot/rate-limit/API behaviour untouched.

- [ ] **Step 4: Run the full app suite**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ReportModal.tsx test/app/ReportModal.test.tsx
git commit -m "feat(ui): pin the report sheet to the viewport

The sheet was a padded flex child of an items-end overlay, so a tall
sheet ran past the viewport top and the page behind still scrolled."
```

---

## Required manual verification (not a task)

**Render both pages at desktop AND phone widths and look at them.** Two of the last three rounds shipped a visual defect a fully green suite did not catch.

Desktop is straightforward: build, seed, `wrangler dev`, headless screenshot at 1200px.

**Phone needs a real viewport, not a narrow window.** `--window-size=390,…` *crops* rather than reflows, so it cannot judge the phone layouts — and half this round is phone-specific. Use one of:
- `--window-size=390,844` **plus** `--force-device-scale-factor=1` and a device-metrics override, or
- the approach the designer's own `Mobile Preview.dc.html` uses: a 390×844 iframe in a desktop-sized page.

Specifically check: the two segmented controls fit one row at 390px; five forecast cards fit across 390px with nothing scrolling; twelve hourly cards overflow into a scroll rather than shrinking; chart tick text is legible; the report sheet's Send button is visible without scrolling the sheet.

`wrangler dev` serves a stale `index.html` after a rebuild — if only the SEO shell renders, stop the server, `rm -rf .wrangler/state/v3/cache .wrangler/tmp` (**not** the whole `.wrangler`, which holds the local D1), restart.

## Deploy note

No migration, no API change — Worker code and static assets only. Deploy is `npm run deploy` after the usual verification. `scripts/verify-launch.sh` should pass unchanged: nothing here touches the SEO shell, the status banner, or any route.
