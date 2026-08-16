# Hourly forecast row + brand-consistent weather icons

Date: 2026-08-16
Status: draft for Drew's review
Supersedes parts of: `2026-08-16-nws-forecast-design.md` (the icon-proxy decision)

## Goal

Two changes to the forecast area of the home screen, now that the 5-day strip
is live and Drew has seen it in production:

1. **Add a rolling next-12-hours row above the 5-day strip.** The current daily
   cards answer "what is this week like"; they do not answer "what happens
   between now and when I get over the pass", which is the question this site
   exists for.
2. **Replace the NWS icon artwork with the site's own icon language.** The
   photographic NWS PNGs — bright blue skies, hard square edges — read as
   imported against the warm cream/ink palette. The app already has an
   established icon treatment; the forecast should use it.

## Decisions already made (settled with Drew, not open for re-litigation)

- **The hourly window is a rolling next 12 hours, not today's calendar hours.**
  "Remaining hours today" thins to two cards by 9pm and is empty by 11:30pm,
  under a heading that still says TODAY. A rolling window never degrades and
  answers the 9pm question (what is the morning commute doing). The row is
  therefore headed **"Next 12 hours"**, not "Today".
- **Glyphs are emoji on the existing tile**, matching `AlertsStrip` exactly:
  `bg-icon-tile`, `rounded-[10px]`, centered. Drew chose this over a drawn SVG
  set with the cross-platform-rendering tradeoff stated explicitly. The site
  already ships emoji-on-tile for community alerts, so this is consistent with
  a decision already made rather than a new one.
- **Hourly data lives in its own table** (approach A of three), fully replaced
  each refresh in one atomic batch. Rejected: a raw JSON blob parsed per
  request (re-parses ~156 periods on every homepage hit, and contradicts the
  idiom already chosen for the daily rollup), and a JSON `hours` column on
  `forecast_days` (fattens the daily row and makes one table serve two jobs).

## Non-goals (hard constraints carried forward)

- **The forecast never influences the OPEN / RESTRICTED / CLOSED banner.**
  Neither the hourly row nor the icon change goes anywhere near `status`,
  `isStale`, `pollerDead`, or `lastConfirmed`. The existing byte-identical
  regression test in `api-status.test.ts` must still pass, and must be extended
  to cover the new `hourly` field the same way.
- **No invented reopening estimates, no predicted road conditions.** An hourly
  weather row sitting near a closure banner is exactly where this rule is
  easiest to violate by accident. No copy may imply when a closed pass reopens,
  and no hour may be labelled with a road state.
- **Absence is `null` / `[]`, never `0` or a placeholder.**
- No 7-day expansion, no tap-to-expand day detail, no notifications.

## The icon proxy is removed

`/api/wx-icon/*` and `ApiStatus.forecast[].iconPath` exist for one purpose:
serving NWS artwork to the 5-day strip. Once glyphs are local, nothing consumes
them. An unused public endpoint that performs outbound fetches on a
client-supplied path is attack surface with no user, so it goes rather than
lingering.

**Deleted:** `src/worker/api/wx-icon.ts`, its route in `router.ts`, the
`ApiStatus.forecast[].iconPath` field, `test/worker/api-wx-icon.test.ts`, and
the `toIconPath` assertion added to `test/parsers/nws-forecast.test.ts`.

**Kept:** the `forecast_days.icon_url` column and the `forecast_hours.icon_url`
column below. They are captured upstream data, cost nothing, and are the raw
material if artwork is ever wanted again. They simply stop being exposed.

This is a removal of a *public API route*. It has no external consumers (it
shipped hours ago and is referenced only by our own page), but the deploy note
below still applies.

## Schema — migration 0010

```ts
/**
 * Hourly NWS periods for the near-term forecast row. Fully replaced on each
 * refresh rather than upserted: unlike `forecast_days`, whose rows are a
 * stable set of dates worth revising in place, these are a sliding window
 * where yesterday's 3 PM is simply gone. Replace-all keeps the table from
 * accumulating a tail nobody reads and removes any need for a prune job.
 */
export const forecastHours = sqliteTable('forecast_hours', {
  // ISO instant with offset, exactly as NWS sends it. Primary key because a
  // period is uniquely identified by when it starts.
  startTime: text('start_time').primaryKey(),
  tempF: real('temp_f'),
  category: text('category').notNull(),
  // Whether NWS considers this period daylight. Stored because the glyph
  // depends on it -- a clear 10 PM hour must not show a sun.
  isDaytime: integer('is_daytime', { mode: 'boolean' }).notNull(),
  iconUrl: text('icon_url'),
  shortForecast: text('short_forecast'),
  precipPct: integer('precip_pct'),
  fetchedAt: text('fetched_at').notNull(),
});
```

**Only the first 48 periods are stored**, not all 156. Twelve are needed; 48
gives roughly two days of buffer so the row survives a poller outage of up to
~36 hours before it starts thinning, while keeping the replace-all batch at 49
statements (one `DELETE`, 48 inserts) instead of 157.

Per CLAUDE.md, migrations 0000–0009 are frozen (0009 is now applied to remote
D1). This is a new `0010_*.sql` from `npm run db:generate`.

## Poller

`runForecastStep` in `src/worker/poller/nws-forecast.ts` already fetches the
156 periods and currently discards everything the daily rollup does not use.
It gains a second write from the *same* fetched payload — no additional network
call, and the existing hourly throttle (`FORECAST_REFRESH_MIN`, 60) still
governs both.

Both writes go in **one `db.batch()`**: the daily upserts, plus
`DELETE FROM forecast_hours` followed by the 48 hourly inserts. One transaction
means the two tables can never disagree about which fetch they came from —
which matters because they are rendered adjacent to each other and a reader
would notice a today-card that contradicts the hour below it.

A new pure function `takeHours(periods, limit)` in the same module normalizes
each period to the stored shape, reusing the existing `categorize()` and
`toF()`. It is unit-testable against the same fixture as `rollupDaily`.

## API

`GET /api/status` gains `hourly` and loses `forecast[].iconPath`:

```ts
export interface ForecastHour {
  startTime: string;    // ISO with offset, as NWS sent it
  tempF: number | null;
  category: ForecastCategory;
  isDaytime: boolean;
  shortForecast: string | null;
  precipPct: number | null;
}

// on ApiStatus:
hourly: ForecastHour[];   // next 12 hours, oldest first; [] when unavailable
```

**Query, and why it is not a single SQL comparison.** The obvious form is
`WHERE start_time >= ? ORDER BY start_time LIMIT 12` with the current instant
bound as a string. That is a lexicographic comparison of ISO-with-offset
strings, which is only equivalent to a chronological one while the offset is
constant. Across a DST change it is not: `2026-11-01T01:00:00-06:00` and
`2026-11-01T01:00:00-07:00` are the same wall-clock text with an hour between
them, and they sort by the wrong key.

So the read is: `SELECT ... ORDER BY start_time LIMIT 24`, then filter in JS
with `Date.parse(row.startTime) >= nowMs` and take the first 12. Parsing gives
a true instant regardless of offset. Twenty-four rows is a trivial read, and
this removes the whole class of bug rather than reasoning about whether it can
bite. Teton Pass shifts offset twice a year — and those two nights are exactly
when someone is checking a dark, icy pass.

Same failure contract as `forecast`: its own try/catch, degrading to `[]`, and
a read failure must not fail `/api/status`.

`forecastStale` continues to govern both rows — one upstream, one freshness
signal, no second flag.

## Glyphs

A new `src/app/weatherGlyphs.ts`, sitting beside the existing
`src/app/alertTypes.ts` and following its structure and rationale comment:

```ts
export const WEATHER_GLYPH: Record<ForecastCategory, string> = {
  clear: '☀️',
  'partly-cloudy': '⛅',
  cloudy: '☁️',
  rain: '🌧️',
  snow: '❄️',
  mixed: '🌨️',
  thunderstorm: '⛈️',
  fog: '🌫️',
};

/** Night variants for the two categories where a sun would be wrong. */
export const WEATHER_GLYPH_NIGHT: Partial<Record<ForecastCategory, string>> = {
  clear: '🌙',
  'partly-cloudy': '☁️',
};

export function glyphFor(category: ForecastCategory, isDaytime: boolean): string;
```

Every glyph above uses **emoji presentation**, with an explicit U+FE0F
variation selector on the characters that would otherwise default to
monochrome text (`☀️`, `☁️`, `❄️`). That is a deliberate choice for internal
consistency: a row mixing flat-ink and full-colour glyphs looks broken in a way
neither style does on its own. Note this differs from `alertTypes.ts`, which
uses bare `❄` and `⚠` — those appear one at a time, so the inconsistency never
shows.

Day/night matters for exactly two categories — `clear` and `partly-cloudy` — a
clear 10 PM hour showing a sun is the kind of small wrongness that makes a
whole strip feel untrustworthy. Precipitation and cloud glyphs are shared.

The 5-day cards always use the **day** variant: a daily summary is not an hour.

**Presentation risk, to be settled by looking rather than reasoning.** Some
weather characters default to monochrome text presentation (`☀` U+2600, `☁`
U+2601, `❄` U+2744) while others are emoji-only (`⛅` U+26C5, `⛈` U+26C8), and
mixing the two produces a visibly inconsistent row — some glyphs flat ink,
others full colour. `AlertsStrip` already mixes them, but its glyphs appear one
at a time; a forecast row shows five or twelve at once. **The implementation
must render the full set on a real page and inspect it before the set is
final**, and adjust (adding or removing U+FE0F variation selectors, or swapping
a character) until the row reads as one family. This is a required step, not a
nice-to-have — see `docs` note below on why.

## UI

`ForecastStrip.tsx` keeps its structure; the `<img>` and its broken-image slot
logic are replaced by the glyph on a `bg-icon-tile` tile. The reserved-space
bug that was fixed for missing images cannot recur — a glyph is always present
— but the tile keeps a fixed size so the cards stay aligned regardless.

New `HourlyStrip.tsx`, rendered **above** `ForecastStrip`, inside the same
wrapper `<div>` so it shares the °F/°C toggle:

- `<h2>Next 12 hours</h2>`, same treatment as the sibling headings.
- Horizontally scrollable (`overflow-x-auto`), 12 fixed-width cards. Scroll
  rather than shrink: twelve cards across a 360px phone is 30px each, which is
  unreadable, and horizontal scroll is the established pattern for this content
  everywhere else on the web.
- Per card: hour label (`3 PM`, America/Denver), glyph on tile, temperature via
  `formatTemp`, precip %.
- `hourly: []` renders nothing at all — no empty frame.
- The scroll container must not make the page scroll horizontally.

## Testing

**`test/parsers/`** — `takeHours` against the live fixture: the 48-period cap,
`isDaytime` preserved per period, category reuse matching `rollupDaily`'s for
the same hour, a null `probabilityOfPrecipitation`, and Celsius normalization.

**`test/worker/`** — the hourly rows are written in the same batch as the daily
rows (assert both tables carry the same `fetched_at` after one cycle);
replace-all leaves no stale rows from a previous fetch; `/api/status` returns
at most 12, none in the past, oldest first; the DST-safe filter returns the
correct set when rows straddle an offset change; a forecast-table read failure
degrades to `hourly: []` with the rest of the response intact; and the
**byte-identical hard-rule test is extended to strip `hourly` alongside
`forecast`/`forecastStale`**.

**`test/app/`** — `HourlyStrip` renders 12 cards, respects the unit toggle,
shows `—` for null precip, renders nothing when empty, and uses the night
glyph for a non-daytime hour. `ForecastStrip` renders glyphs rather than
`<img>`, and no test may assert on `iconPath` any more.

**Removed:** the entire `api-wx-icon` suite, with the proxy.

**Required manual step:** render the page and look at the glyph row, per the
presentation risk above. The last change to this component shipped a
five-card row where one card's contents sat 40px higher than the others, with
all 283 tests passing — layout and typographic defects in this area are
invisible to the suite by construction.

## Deploy note

Same ordering rule as before, and it now cuts both ways:

1. Apply migration 0010 to remote D1 **before** deploying the Worker that reads
   `forecast_hours`.
2. The Worker deploy removes `/api/wx-icon/*`. Any page still holding the old
   bundle will request icon paths that now 404. Those are `<img>` requests with
   an `onError` handler, so they degrade to a card without a picture rather
   than a broken page — acceptable, and self-corrects on the next load.
3. `hourly` is a new **required** field on `ApiStatus`. Per the hazard recorded
   in the last cycle, a returning user's cached payload will not contain it —
   `HourlyStrip` must guard with `hourly?.length` from the first commit, and
   the `App.test.tsx` regression test for a pre-schema cached payload must be
   extended to delete `hourly` as well as `forecast`.
