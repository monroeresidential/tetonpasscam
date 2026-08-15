# Historic temperatures on /history — Design

Date: 2026-08-15. Drew-approved decisions: typical temp by hour of day (same shape as the drive-time chart, not daily high/low and not a dual-axis overlay); plot air + surface temp while capturing every sensor the page offers; site-wide °F/°C toggle persisted to localStorage, defaulting to °F; generalize `TypicalChart` in place rather than copying it or extracting a third abstraction.

## Goal

Plot typical air and road-surface temperature by hour of day on `/history`, with the same p25–p75 band and the same per-bucket confidence gate the drive-time chart already uses, and a °F/°C toggle that applies across the site.

## Starting state — most of the pipeline already exists

`src/worker/poller/wydot-weather.ts` already parses `Sensors.StationResults?SelectedStation=Teton+Pass` every poll cycle (`run.ts` step 3) and writes `weather_snapshots`. Production held **642 rows** at design time (2026-08-10 → 2026-08-15), with `air_f` on 642/642, `surface_f` on 639, and an observed range of 45–79 °F. `applyRetention` already keeps two years.

So this is not a scraping project. Three things are missing: two sensors are parsed and discarded, nothing aggregates weather into typicals, and nothing displays any of it.

## Why °C is derived, not stored

WYDOT prints `70°F (21°C)`. Stored values confirm temps arrive as whole integers (50, 48, 67, 65) while wind carries decimals (5.6, 3.7) — so WYDOT rounds temperature to whole °F, and its parenthesized °C is a rounded conversion of an already-rounded number. Storing both would give two figures that disagree (70 °F is 21.1 °C, not 21) and can drift. `C = (F − 32) × 5/9` is exact, so **°F is the only stored unit** and °C is computed at display.

## Architecture

### 1. Capture the discarded sensors (ships first, independently)

The page carries **Relative humidity** and **Dew point**; `wydot-weather.ts:171` drops both (`if (!field) continue`). Capture is not backfillable, so this lands first and starts accumulating immediately even though nothing in this design charts it yet.

- New migration (let drizzle-kit assign the number — the repo is at 0006 and the plan must not hardcode a filename): `weather_snapshots` gains `humidity_pct REAL` and `dew_point_f REAL`, both nullable.
- `WeatherReading` gains `humidityPct: number | null` and `dewPointF: number | null`.
- `NumericField` gains `'humidityPct' | 'dewPointF'`; `matchNumericLabel` gains `/^relative humidity$/i → 'humidityPct'` and `/^dew point$/i → 'dewPointF'`.
- `run.ts`'s weather insert carries both.

Both parse through the existing `extractNumber` (first number in the cell): `34%` → 34, `41°F (5°C)` → 41. Both fixture rows are preceded by a commented-out stale value (`N/A` and `32°F` respectively), so asserting 34 and 41 also guards that comment-stripping still covers these fields.

### 2. `weather_typicals`

A new table, built by the existing `runNightly`, reusing `nearestRank` and `denverDateKey`, gated by the same `MIN_DISTINCT_DAYS_FOR_BAND` (= 4) from `src/shared/history.ts`.

```
weather_typicals(metric TEXT, weekday_class TEXT, hour INTEGER, season TEXT,
                 median REAL, p25 REAL, p75 REAL,
                 sample_count INTEGER, distinct_days INTEGER)
PRIMARY KEY (metric, weekday_class, hour, season)
```

**Rows per metric, not columns per metric.** Weather is one station rather than twelve routes, so this tops out at 96 rows per metric — trivially small — and charting dew point later becomes data rather than another migration. Metrics computed from day one: `air_f`, `surface_f`, `dew_point_f`, `humidity_pct`. The latter two simply produce no rows until their columns have data, which costs nothing.

Same window as `rebuildTypicals` (`TYPICALS_WINDOW_DAYS` = 365) and the same single-`batch` DELETE-then-rebuild transaction, for the same atomicity reason.

Accepted consequence, identical to drive times: weekday buckets qualify for a band now (~5 distinct days); weekend buckets accrue 2 days/week and so show median-only for roughly two more weeks.

### 3. `GET /api/weather-history`

A separate endpoint rather than a field on `/api/history`. Weather is station-wide while `/api/history` is `?route=`-scoped; hanging temps off a route parameter would imply they differ per route. The `/history` page makes two independent calls, both cheap.

```ts
interface WeatherHistoryResult {
  typicals: {
    metric: 'air_f' | 'surface_f' | 'dew_point_f' | 'humidity_pct';
    weekdayClass: 'weekday' | 'weekend';
    season: 'winter' | 'summer';
    hour: number;
    median: number | null;
    p25: number | null;
    p75: number | null;
    sampleCount: number | null;
    distinctDays: number | null;
  }[];
  today: { capturedAt: string; airF: number | null; surfaceF: number | null }[];
}
```

`today` = `weather_snapshots` rows since Denver-local midnight, ascending, mirroring `/api/history`'s `today`.

### 4. Generalize `TypicalChart`

`TypicalChart` is seconds-flavored throughout: `ChartPoint.medianSec/p25Sec/p75Sec`, `today[].durationSec`, and a `minutes()` formatter for the now-label. A chart does not need to know whether a value is seconds or degrees.

Rejected alternatives, recorded because the choice matters: **copying it into a `TempChart`** repeats precisely the duplication that produced the Critical weekday/weekend-mixing bug in the `/history` cycle; **extracting a generic `BandChart` core** with two thin wrappers is defensible but adds a third abstraction layer for two consumers.

Changes:

- Rename `medianSec`/`p25Sec`/`p75Sec` → `median`/`p25`/`p75` on `ChartPoint`, and `durationSec` → `value` on the `today` series. Mechanical, and it ripples through `historyChart.ts`, `HistoryPage.tsx`, `HomeHistoryCard.tsx`, and their tests.
- New `formatValue?: (v: number) => string` prop, defaulting to the current minutes formatting so the drive-time chart is behaviorally unchanged.
- New optional `secondary?: ChartPoint[]` series: a median line only, no band. Used for surface temp.
- New optional `referenceValue?: { value: number; label: string }`: a dashed horizontal rule. Used for freezing.
- The y-domain must span the primary series, the secondary series, and `today` — surface runs 15–20 °F above air in summer and inverts in winter, so a domain computed from one series alone will clip the other.

`bandRuns` is untouched: it gates the primary series only, and the secondary is drawn without a band.

**Series assignment, stated explicitly so it cannot be read two ways:**

| Role | Data |
|---|---|
| primary (band + median) | air temp typicals |
| secondary (median only) | surface temp typicals |
| `today` (+ now-dot) | today's **air** readings only |

Today's surface readings are returned by the API but **not plotted** — a fourth line on a chart that already carries a band, two medians, and a today trace buys less than it costs. The endpoint still returns `surfaceF` in `today` rather than being over-fitted to this one chart.

**The freezing reference is conditional, not always drawn.** Rendering it unconditionally would force the y-domain to include 32 °F, so an August chart spanning 45–79 °F would stretch to 32–79 °F and squander a third of its height on empty space. Draw it only when the plotted data actually comes near freezing — when the domain minimum is at or below 32 °F, or within a few degrees of it — and include its value in the domain only when it is drawn.

### 5. Units — `src/app/units.ts`

- `fToC(f: number): number` — `(f − 32) × 5/9`.
- `useTempUnit()` — returns the current `'F' | 'C'` and a setter, persisting to `localStorage` behind the same try/catch `deviceId.ts` already uses (private browsing and disabled storage must degrade to the default, never throw). Default `'F'`.
- A small toggle control rendered on `/history` and beside the home strip.
- Consumed by the chart's axis, its now-label, its freezing reference, and `WeatherStrip`'s Air/Road tiles (`WeatherStrip.tsx:69` and `:72` currently hardcode `°F`), so the two pages can never disagree on units.

The freezing reference is defined in °F (32) and converted with everything else, so it lands on 0 °C correctly rather than being a hardcoded pixel position.

## Task split

- **T1 (capture):** migration + `WeatherReading` + `matchNumericLabel` + poller insert + parser tests. Ships independently; nothing downstream depends on it.
- **T2 (aggregation):** `weather_typicals` migration + `runNightly` extension + worker tests.
- **T3 (API):** `/api/weather-history` + shared types + worker tests.
- **T4 (chart generalization):** the rename, `formatValue`, `secondary`, `referenceValue`, and y-domain fix, with the existing drive-time chart tests proving no behavior change.
- **T5 (units):** `units.ts`, the toggle, and `WeatherStrip` adoption.
- **T6 (wire-up):** the temp chart section on `/history`, consuming T3 through T5.

## Testing

- **Parser:** `humidityPct` = 34 and `dewPointF` = 41 from `sensors-tetonpass.html`, which also proves comment-stripping still covers the new labels (the stale commented values are `N/A` and `32°F`); both null in `sensors-tetonpass-blank-air.html` where applicable.
- **Worker:** weather typicals distinct-days counting, including the many-samples-few-days shape; per-metric row separation; the endpoint's shape and its `today` Denver-midnight boundary.
- **App:** °F↔°C conversion including a negative temperature; toggle persistence across remount and graceful degradation when `localStorage` throws; the two-series chart rendering both lines with a band on the primary only; the freezing line drawn when the domain reaches freezing and **omitted when it does not** (a summer domain must not be stretched to reach it); its position correct in both units; and the drive-time chart unchanged by the rename.

## Out of scope

Charting humidity or dew point (captured, not drawn); backfilling history before 2026-08-10; a wind or visibility chart; any change to the current-conditions weather strip beyond units.

## Follow-ups

- Revisit `MIN_DISTINCT_DAYS_FOR_BAND` against real weather bucket counts once the nightly job has run against a few weeks of data — it remains reasoned from the poll cadence rather than measured.
- Dew point within a few degrees of surface temp is the frost-formation signal; once both have history, a derived "frost risk" indicator is a natural follow-on.
