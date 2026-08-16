# 5-day summit forecast (api.weather.gov)

Date: 2026-08-16
Status: approved, ready for planning

## Goal

Show a 5-day weather forecast for the Teton Pass summit on the home screen,
below the existing summit sensor tiles, and give those sensor tiles the
visible heading they currently lack.

Two user-visible outcomes:

1. `WeatherStrip`'s tiles get an `<h2>Summit conditions</h2>` so a reader knows
   the numbers describe the top of the pass, not Wilson or Jackson.
2. A new 5-day strip below it: weekday, one weather icon, high/low, precip %.

## Non-goals (hard constraints, not preferences)

- **The forecast never influences the OPEN / RESTRICTED / CLOSED banner.**
  It is not an input to `resolveStatus`, it cannot escalate or de-escalate a
  status, and its absence never degrades one. A forecast is weather adjacent
  to road state, not evidence about road state.
- **No predicted road conditions and no reopening estimates.** CLAUDE.md rule
  5 forbids invented reopening times; a snow forecast rendered next to a
  closure must not be phrased in a way that implies when the road returns.
- No hourly detail view, no expand-on-tap, no push notifications on forecast
  changes. Those are separate features if they are ever wanted.

## Source: api.weather.gov

Free, no key, no signup — only a descriptive User-Agent, the same etiquette
already applied to wyoroad.info fetches. Chosen over Open-Meteo because
Open-Meteo's free tier is non-commercial and this site carries a sponsor.

### Grid resolution (verified 2026-08-16)

`GET /points/43.4986,-110.9564` (Teton Pass summit, WY-22 high point)
resolves to grid **`RIW / 35,140`**.

That grid cell reports its own elevation as **2582.88 m (8,474 ft)**, which
confirms the cell covers the pass itself rather than the valley floor — the
single most important thing to verify about a mountain forecast, since a
neighbouring cell 6 km west would forecast Wilson at 6,200 ft and be wrong in
exactly the way that matters.

The office/x/y triple is stored as a module constant, **not** re-resolved every
cycle. NWS does occasionally re-grid; the fallback is: if the gridpoint fetch
returns 404, re-resolve via `/points` once and use the result for that cycle
(logged, so a persistent re-grid is visible and the constant can be updated).

### Endpoint and payload (verified 2026-08-16)

`GET /gridpoints/RIW/35,140/forecast/hourly` returns 156 hourly periods
(~6.5 days), each with:

| Field | Notes |
| --- | --- |
| `startTime` | ISO with a `-06:00`/`-07:00` offset — already Denver-local |
| `isDaytime` | correct per hour (true 06:00–19:00, false overnight) |
| `temperature` + `temperatureUnit` | always `F` for this office |
| `probabilityOfPrecipitation.value` | percent; **nullable** |
| `shortForecast` | e.g. `Slight Chance Showers And Thunderstorms` |
| `icon` | e.g. `.../icons/land/day/tsra_hi,20?size=small` |
| `windSpeed` | a *string*, `"6 mph"` — must be parsed, not cast |

The 12-hour `/forecast` endpoint was rejected: it yields two periods per day,
which gives nothing to count for a frequency-based icon.

## Approach: derive on poll, store 5 daily rows

The poller collapses 156 hourly periods into one row per Denver calendar day
and `/api/status` reads those rows directly. Rejected alternatives: storing the
raw hourly blob and deriving per request (re-parses 156 periods on every
homepage hit), and caching in KV (the one storage layer this project does not
already use, and forecast-vs-actual is data worth being able to query later).

The cost of deriving at write time is that an icon-rule change takes up to one
refresh interval to appear. That is acceptable.

### The daily rollup rule

For each Denver calendar day, from that day's hourly periods:

- **Category and icon**: consider only periods with `isDaytime: true`.
  Normalize each `shortForecast` into one of eight categories — `clear`,
  `partly-cloudy`, `cloudy`, `rain`, `snow`, `mixed`, `thunderstorm`, `fog`.
  Take the most frequent. **Ties break toward severity**
  (`thunderstorm > snow > mixed > rain > fog > cloudy > partly-cloudy > clear`)
  so a genuinely half-and-half day shows the hazard rather than the sunshine.
  Store the `icon` URL of the first daytime period matching the winning
  category, so the icon and the category can never disagree.
- **High / low**: min and max `temperature` across the **full 24 hours**, not
  just daylight — an overnight low is the number a driver cares about.
- **Precip %**: max non-null `probabilityOfPrecipitation.value` across the full
  day. Null when every period that day is null (stored as NULL, rendered as
  `—`, never as `0%`).
- **Wind gust**: max parsed `windSpeed` across the full day. Nullable.

**The trailing day only** is dropped if it has fewer than 12 periods. The
156-period window ends mid-evening, so its last day would otherwise compute a
"high" from a handful of hours and read as a cold snap.

This rule applies to the *last* day in the window and nothing else. Today is
always kept however few periods remain — a poll at 8 PM leaves today with four
hourly periods, and a strip whose first card silently became tomorrow would be
actively misleading. Today's high is therefore "the highest remaining hour
today", which is the honest reading of a partial day.

### Refresh cadence

The step runs inside the existing poll cycle in `run.ts`, but self-throttles:
if the newest `forecast_days.fetched_at` is younger than `FORECAST_REFRESH_MIN`
(60), it returns immediately without a network call.

Drew's initial ask was every 15 minutes. NWS regenerates these forecasts
roughly hourly (`generatedAt` / `updateTime` in the payload confirm this), so a
15-minute poll would fetch the same bytes four times per update. Hourly is no
less current and is a better neighbour. `FORECAST_REFRESH_MIN` is a single
constant if that judgement turns out to be wrong.

Fetch etiquette matches `wydotFetch`: descriptive User-Agent with contact
email, 30s `AbortSignal.timeout`, one retry after ~2s backoff on 5xx or throw,
`null` on exhaustion.

## Schema — migration 0009

```ts
export const forecastDays = sqliteTable('forecast_days', {
  date: text('date').primaryKey(),      // America/Denver yyyy-mm-dd
  highF: real('high_f'),
  lowF: real('low_f'),
  category: text('category').notNull(), // the eight-value enum above
  iconUrl: text('icon_url'),            // NWS icon URL, proxied at render time
  shortForecast: text('short_forecast'),// winning period's text; img alt
  precipPct: integer('precip_pct'),
  windGustMph: real('wind_gust_mph'),
  fetchedAt: text('fetched_at').notNull(),
});
```

Upserted by `date` (`ON CONFLICT(date) DO UPDATE`), so each refresh revises the
same five-ish rows rather than accumulating history. Rows for past dates are
left in place — they cost nothing and become the raw material for any future
forecast-vs-actual comparison.

Per CLAUDE.md: migrations 0000–0008 are frozen. This is a new `0009_*.sql`
generated by `npm run db:generate`, never an edit to an existing file.

## API

`GET /api/status` gains two fields, mirroring how `weather` / `weatherStale`
already behave:

```ts
export type ForecastCategory =
  | 'clear' | 'partly-cloudy' | 'cloudy' | 'rain'
  | 'snow' | 'mixed' | 'thunderstorm' | 'fog';

export interface ForecastDay {
  date: string;              // Denver yyyy-mm-dd
  highF: number | null;
  lowF: number | null;
  category: ForecastCategory;
  iconPath: string | null;   // proxy path, NOT an api.weather.gov URL
  shortForecast: string | null;
  precipPct: number | null;
}

// on ApiStatus:
forecast: ForecastDay[];     // [] when unavailable; never fabricated
forecastStale: boolean;      // newest fetched_at older than 6h
```

Only dates >= today (Denver) are returned, capped at 5. An empty array is the
honest representation of "we have nothing" — there is no placeholder day.

**A failed forecast fetch must not fail the status response.** The forecast
query is independent; if it throws, `/api/status` returns `forecast: []` and
every other field unchanged.

## Icon proxy

Icons are NWS artwork (Drew's call — no custom glyph set), but served through
our own worker rather than hotlinked, so the "clients only ever read our own
API" rule holds and an NWS endpoint retirement becomes a proxy-internals change
instead of a broken page.

`GET /api/wx-icon/*` → `https://api.weather.gov/icons/*?size=medium`

The path must survive commas and interior slashes: NWS composites look like
`land/day/tsra_hi,20` and dual-condition days look like
`land/day/rain,60/snow,40`.

**Security — this is an outbound fetcher taking a user-controlled path, so it
is an open-proxy risk unless constrained:**

- Reject anything not matching `^land/(day|night)/[a-z_]+(,\d{1,3})?(/[a-z_]+(,\d{1,3})?)?$`.
- Build the upstream URL from the validated match, never by string-concatenating
  raw input; force `size=medium` and drop all client query params.
- Fixed upstream host constant — the client supplies a path, never a host.
- Respond `Cache-Control: public, max-age=31536000, immutable` (these URLs are
  content-addressed by condition) and pass through only `Content-Type`.
- Non-image or non-200 upstream → 502, not a pass-through of arbitrary bytes.

## UI

### `WeatherStrip` heading

Add above the tile grid, matching the existing `<h2>Cameras</h2>` treatment
(`font-display text-[15px] font-bold`):

```
Summit conditions
WY-22 summit · 8,431 ft        <- muted, text-[11px]
```

8,431 ft is the posted highway summit elevation and is the right number to
show a driver. It deliberately differs from the 8,474 ft the NWS grid cell
reports for itself (a 2.5 km cell average, recorded above only as evidence
that the cell covers the pass). Do not "correct" one to match the other.

The existing `aria-label="Summit weather"` on the `<section>` is replaced by
`aria-labelledby` pointing at the new heading, so the accessible name comes
from visible text instead of duplicating it.

### `ForecastStrip.tsx` (new)

Renders below `WeatherStrip`, inside the same wrapper `<div>` so it shares the
°F/°C toggle already sitting above the tiles.

- `<h2>5-day forecast</h2>`, same heading treatment.
- `grid grid-cols-5 gap-2`; each card is the same
  `bg-card border-card-border rounded-card border` as a sensor tile.
- Per card: weekday abbreviation (`Sat`; today renders as `Today`), icon,
  `high/low`, precip %.
- Temperatures go through the existing `formatTemp(f, unit)`, so the °F/°C
  toggle governs the forecast too. **`highF`/`lowF` are stored in Fahrenheit**
  like every other temperature in this codebase.
- `<img>` gets explicit `width`/`height` and `loading="lazy"` so five images
  cannot cause layout shift (Lighthouse mobile >= 90 is a P1 gate),
  `alt={shortForecast ?? category}`, and an `onError` that hides the image and
  leaves the text card intact.
- `forecast: []` → the component renders nothing at all (no empty frame).
- `forecastStale` → a muted "Forecast may be outdated" line, matching the
  existing `weatherStale` treatment rather than hiding the data.

## Testing

**`test/parsers/nws-forecast.test.ts`** — the rollup as a pure function over a
captured fixture (`test/fixtures/nws-hourly.json`, saved from the real
2026-08-16 response):

- Denver-midnight bucketing: an hour at `23:00-06:00` and one at `00:00-06:00`
  land on different dates.
- Daylight-only category selection ignores overnight periods.
- Severity tie-break: a day with equal snow and clear daytime counts → `snow`.
- All-null `probabilityOfPrecipitation` → `null`, not `0`.
- The <12-period trailing day is dropped; a partial *today* is kept.
- `windSpeed` string parsing, including a range form (`"5 to 10 mph"`).

**`test/worker/forecast.test.ts`** —

- Throttle: two cycles inside `FORECAST_REFRESH_MIN` produce exactly one fetch.
- Upsert: a second fetch revises the same date rows, does not duplicate them.
- **NWS down → `forecast: []` and `status` byte-identical to the no-forecast
  baseline.** This is the hard-rule regression test.
- `/api/status` shape: 5 days max, no past dates, `iconPath` is a proxy path
  and never contains `api.weather.gov`.
- Proxy: valid composite path passes; `../`, an absolute URL, an unknown host,
  and an uppercase/overlong path are all rejected.

**`test/app/ForecastStrip.test.tsx`** — 5 cards render; °F/°C toggle switches
forecast temps too; `[]` renders nothing; `forecastStale` shows the notice;
precip `null` renders `—`.

## Files touched

| File | Change |
| --- | --- |
| `src/worker/poller/nws-forecast.ts` | new — fetch, rollup, category mapping |
| `src/worker/poller/run.ts` | call the step, throttled |
| `src/worker/db/schema.ts` | `forecastDays` table |
| `migrations/0009_*.sql` | generated |
| `src/worker/api/status.ts` | read + attach `forecast` / `forecastStale` |
| `src/worker/api/wx-icon.ts` | new — validated icon proxy |
| `src/worker/api/router.ts` | mount `/api/wx-icon/*` |
| `src/shared/types.ts` | `ForecastDay`, `ForecastCategory`, `ApiStatus` fields |
| `src/app/components/ForecastStrip.tsx` | new |
| `src/app/components/WeatherStrip.tsx` | heading |
| `src/app/App.tsx` | mount `ForecastStrip` |
| tests + fixture | as above |

## Deploy note

Per `docs/RUNBOOK.md` §1 and the dev-environment rule: the 0009 migration must
be applied to remote D1 **before** the Worker that reads `forecast_days` is
deployed, or `/api/status` throws on a missing table for every request in the
gap.
