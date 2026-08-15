# Historic Temperatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plot typical air and road-surface temperature by hour of day on `/history`, with the same p25–p75 band and per-bucket confidence gate the drive-time chart uses, plus a site-wide °F/°C toggle.

**Architecture:** The WYDOT sensor page is already scraped every cycle into `weather_snapshots`. Two discarded sensors get captured, a `weather_typicals` table is aggregated nightly alongside the existing route typicals, a new station-wide endpoint serves it, and the existing `TypicalChart` is generalized from seconds-specific to unit-agnostic so one component serves both charts.

**Tech Stack:** React 19 + Vite (multi-page), Hono on Cloudflare Workers, D1 + drizzle-kit, Tailwind v4 (`@theme` tokens), Vitest (three configs: parsers/node, worker/workers-pool, app/jsdom).

**Spec:** `docs/superpowers/specs/2026-08-15-historic-temps-design.md`

## Global Constraints

- **Migrations are append-only.** Applied migrations are frozen. Always `npm run db:generate`; **never hardcode a migration filename** — the repo is at `0006` and drizzle-kit assigns the next number itself. (An earlier plan assumed `0002` when the repo was already at `0004`.)
- **°F is the only stored unit.** °C is computed at display via `(f − 32) × 5/9`. Never persist a Celsius value.
- **Band gate:** `MIN_DISTINCT_DAYS_FOR_BAND = 4` from `src/shared/history.ts`, keyed on `distinct_days`, never on raw sample count. `NULL` distinct-days means "no band", never "band allowed".
- **Denver-local, DST-aware** throughout, via `src/worker/tz.ts` (`denverParts`, `denverDateKey`, `denverMidnightMs`). Never group by UTC date.
- **Design tokens only** for all colors — no hardcoded hex. The app ships a `prefers-color-scheme: dark` token set.
- **No charting library.** Lighthouse mobile ≥ 90 is a project DoD item.
- **Absence is `null`**, never `0` and never a fabricated value.
- **Clients only ever read our own API.**

---

## File Structure

**Create:**
- `src/worker/api/weather-history.ts` — assembles `GET /api/weather-history`.
- `src/app/units.ts` — `fToC`, `formatTemp`, `useTempUnit`. App-side only.
- `src/app/components/TempUnitToggle.tsx` — the °F/°C control.
- `test/worker/api-weather-history.test.ts`, `test/app/units.test.ts`, `test/app/TempChart.test.tsx`

**Modify:**
- `src/worker/poller/wydot-weather.ts` — two new `WeatherReading` fields + two label matches.
- `src/worker/db/schema.ts` — two columns on `weatherSnapshots`; new `weatherTypicals` table.
- `src/worker/poller/run.ts` — insert the two new readings.
- `src/worker/poller/aggregate.ts` — build `weather_typicals` in `runNightly`.
- `src/worker/api/router.ts` — mount the new route.
- `src/shared/types.ts` — `WeatherHistoryResult` and friends.
- `src/shared/history.ts` — `BandPoint` field rename.
- `src/app/components/TypicalChart.tsx` — generalize.
- `src/app/historyChart.ts`, `src/app/HistoryPage.tsx`, `src/app/components/HomeHistoryCard.tsx`, `src/app/components/WeatherStrip.tsx`
- Tests: `test/parsers/wydot-weather.test.ts`, `test/parsers/band-runs.test.ts`, `test/worker/aggregate.test.ts`, `test/app/TypicalChart.test.tsx`, `test/app/historyChart.test.ts`, `test/app/HomeHistoryCard.test.tsx`, `test/app/HistoryPage.test.tsx`, `test/app/WeatherStrip.test.tsx`

**Scope note on the rename (Task 4):** the spec said "five files"; it is actually **ten**, because `ChartPoint` is structurally tied to `BandPoint` in `src/shared/history.ts`. Critically, the rename covers only the **chart's** point type — `HistoryTypical.medianSec` / `p25Sec` / `p75Sec` in `src/shared/types.ts` are the drive-time API contract and really are seconds. **Do not rename those.**

---

## Task 1: Capture relative humidity and dew point

Ships independently — nothing downstream depends on it, and capture cannot be backfilled, so it lands first and starts accumulating immediately.

**Files:**
- Modify: `src/worker/poller/wydot-weather.ts`, `src/worker/db/schema.ts`, `src/worker/poller/run.ts`
- Test: `test/parsers/wydot-weather.test.ts`
- Create: one drizzle-generated migration

**Interfaces:**
- Produces: `WeatherReading.humidityPct: number | null`, `WeatherReading.dewPointF: number | null`; columns `weather_snapshots.humidity_pct`, `weather_snapshots.dew_point_f`.

- [ ] **Step 1: Write the failing tests**

Append to `test/parsers/wydot-weather.test.ts`. Both fixture rows are preceded by a commented-out stale value (`N/A` for humidity, `32°F` for dew point), so asserting the real values also proves comment-stripping covers the new labels:

```ts
describe('parseSensorPage — humidity and dew point', () => {
  it('extracts relative humidity as a percentage', () => {
    const reading = parseSensorPage(sensorsTetonpass)!;
    expect(reading.humidityPct).toBe(34);
  });

  it('extracts dew point in Fahrenheit, taking the US unit not the parenthesized metric', () => {
    // Cell reads "41°F (5°C)" -- the first number is the one we want.
    const reading = parseSensorPage(sensorsTetonpass)!;
    expect(reading.dewPointF).toBe(41);
  });

  it('ignores the stale commented-out value that precedes each real cell', () => {
    // The real dew point cell is preceded by <!--<td>32°F</td>-->. A parser
    // that stopped stripping comments would return 32 here.
    const reading = parseSensorPage(sensorsTetonpass)!;
    expect(reading.dewPointF).not.toBe(32);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test -- wydot-weather`
Expected: FAIL — `humidityPct` is `undefined`.

- [ ] **Step 3: Extend the parser**

In `src/worker/poller/wydot-weather.ts`, add to the `WeatherReading` interface after `visibilityFt`:

```ts
  humidityPct: number | null;
  dewPointF: number | null;
```

Widen the field union and the label matcher:

```ts
type NumericField =
  | 'airF'
  | 'surfaceF'
  | 'windAvgMph'
  | 'windGustMph'
  | 'visibilityFt'
  | 'humidityPct'
  | 'dewPointF';

/** Match a stripped label cell's text to the WeatherReading field it reports, or null if unrecognized. */
function matchNumericLabel(label: string): NumericField | null {
  if (/^air temperature$/i.test(label)) return 'airF';
  if (/^surface temperature$/i.test(label)) return 'surfaceF';
  if (/^wind average$/i.test(label)) return 'windAvgMph';
  if (/^wind gust$/i.test(label)) return 'windGustMph';
  if (/^visibility$/i.test(label)) return 'visibilityFt';
  // Both were previously parsed and thrown away (the old `if (!field)
  // continue` path). Humidity's cell is a bare percentage ("34%") and dew
  // point's carries the usual US-then-metric pair ("41°F (5°C)"), so both
  // fall out of the existing first-number extraction unchanged.
  if (/^relative humidity$/i.test(label)) return 'humidityPct';
  if (/^dew point$/i.test(label)) return 'dewPointF';
  return null;
}
```

Find where the blank `reading` object is initialized in `parseSensorPage` and add `humidityPct: null, dewPointF: null` alongside the other null fields. Update the stale `// e.g. "Relative humidity" / "Dew point" -- not in WeatherReading` comment on the `if (!field) continue` line, which is now wrong.

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test -- wydot-weather`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Add the schema columns**

In `src/worker/db/schema.ts`, inside `weatherSnapshots` after `visibilityFt`:

```ts
  // Both are on the RWIS sensor page and were parsed-then-discarded until
  // now. Nullable like every other reading: an individual sensor can blank
  // out without failing the whole parse. Percent for humidity, Fahrenheit
  // for dew point -- same US-unit-only storage rule as air/surface temp.
  humidityPct: real('humidity_pct'),
  dewPointF: real('dew_point_f'),
```

- [ ] **Step 6: Generate and apply the migration**

Run: `npm run db:generate`
Then: `git status --short migrations/` — expected: exactly one new `.sql`, one new snapshot, and a journal append. If any pre-existing migration shows as modified, **stop** and revert.
Then: `npm run db:migrate:local`

- [ ] **Step 7: Persist the readings**

In `src/worker/poller/run.ts`'s weather insert, after `visibilityFt`:

```ts
        humidityPct: reading.humidityPct,
        dewPointF: reading.dewPointF,
```

- [ ] **Step 8: Run the full worker suite**

Run: `npm run test:worker`
Expected: PASS. `WeatherReading` is imported by `WeatherStrip`, so also run `npm run test:app` and `npx tsc --noEmit`.

- [ ] **Step 9: Commit**

```bash
git add src/worker migrations test/parsers/wydot-weather.test.ts
git commit -m "feat(weather): capture relative humidity and dew point"
```

---

## Task 2: Aggregate weather into `weather_typicals`

**Files:**
- Modify: `src/worker/db/schema.ts`, `src/worker/poller/aggregate.ts`
- Test: `test/worker/aggregate.test.ts`
- Create: one drizzle-generated migration

**Interfaces:**
- Consumes: `nearestRank(sortedAsc: number[], p: number): number` and `denverDateKey(ms: number): string`, both already exported.
- Produces: table `weather_typicals`, populated by `runNightly(env, nowMs)`.

- [ ] **Step 1: Add the table to the schema**

In `src/worker/db/schema.ts`:

```ts
/**
 * Typical weather by (metric, weekday-class, hour, season), rebuilt nightly
 * from `weather_snapshots` exactly the way `route_typicals` is rebuilt from
 * `travel_times`, and gated by the same MIN_DISTINCT_DAYS_FOR_BAND rule.
 *
 * Deliberately ROWS per metric rather than COLUMNS per metric: weather is a
 * single station rather than twelve routes, so this tops out at ~96 rows per
 * metric, and adding a metric later becomes data instead of another
 * migration.
 */
export const weatherTypicals = sqliteTable(
  'weather_typicals',
  {
    metric: text('metric').notNull(),
    weekdayClass: text('weekday_class', { enum: ['weekday', 'weekend'] }).notNull(),
    hour: integer('hour').notNull(),
    season: text('season', { enum: ['winter', 'summer'] }).notNull(),
    median: real('median'),
    p25: real('p25'),
    p75: real('p75'),
    sampleCount: integer('sample_count'),
    distinctDays: integer('distinct_days'),
  },
  (table) => [
    primaryKey({ columns: [table.metric, table.weekdayClass, table.hour, table.season] }),
  ],
);
```

Add `weatherTypicals` to the exported table map at the bottom of the file (alongside `routeTypicals` et al).

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate`, verify with `git status --short migrations/` that no existing migration changed, then `npm run db:migrate:local`.

- [ ] **Step 3: Write the failing test**

Add to `test/worker/aggregate.test.ts`:

```ts
async function weatherTypicalFor(
  metric: string,
  weekdayClass: string,
  hour: number,
  season: string,
): Promise<{ median: number; p25: number; p75: number; sampleCount: number; distinctDays: number } | undefined> {
  return (await env.DB.prepare(
    `SELECT median, p25, p75, sample_count AS sampleCount, distinct_days AS distinctDays
       FROM weather_typicals WHERE metric = ? AND weekday_class = ? AND hour = ? AND season = ?`,
  )
    .bind(metric, weekdayClass, hour, season)
    .first()) as any;
}

async function insertWeather(capturedAt: string, airF: number, surfaceF: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, ?, ?)`,
  )
    .bind(capturedAt, airF, surfaceF)
    .run();
}

describe('runNightly — weather typicals', () => {
  it('aggregates each metric into its own rows, with per-bucket confidence', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    // Five readings in the 08:00 MDT hour spread over TWO Denver days --
    // high sample count standing on little day-to-day evidence, the exact
    // shape the distinct-days gate exists to catch.
    // 14:00 UTC == 08:00 MDT (UTC-6) in August.
    for (const min of ['00', '10', '20']) {
      await insertWeather(`2026-08-11T14:${min}:00.000Z`, 50, 70);
    }
    for (const min of ['00', '10']) {
      await insertWeather(`2026-08-12T14:${min}:00.000Z`, 60, 80);
    }

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const air = await weatherTypicalFor('air_f', 'weekday', 8, 'summer');
    expect(air?.sampleCount).toBe(5);
    expect(air?.distinctDays).toBe(2);
    // nearest-rank p50 of [50,50,50,60,60] -> index ceil(2.5)-1 = 2 -> 50
    expect(air?.median).toBe(50);

    // Surface is a SEPARATE row, not a column on the air row.
    const surface = await weatherTypicalFor('surface_f', 'weekday', 8, 'summer');
    expect(surface?.median).toBe(70);
    expect(surface?.sampleCount).toBe(5);
  });

  it('skips null readings rather than counting them as samples', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, ?, NULL)`,
    )
      .bind('2026-08-11T15:00:00.000Z', 55)
      .run();

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    expect((await weatherTypicalFor('air_f', 'weekday', 9, 'summer'))?.sampleCount).toBe(1);
    // A null surface reading must not produce a surface row at all -- a row
    // with sampleCount 0 would claim we measured something.
    expect(await weatherTypicalFor('surface_f', 'weekday', 9, 'summer')).toBeFalsy();
  });

  it('rebuilds from scratch, leaving no stale rows behind', async () => {
    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await insertWeather('2026-08-11T16:00:00.000Z', 45, 65);
    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));
    expect(await weatherTypicalFor('air_f', 'weekday', 10, 'summer')).toBeTruthy();

    await env.DB.prepare('DELETE FROM weather_snapshots').run();
    await insertWeather('2026-08-11T17:00:00.000Z', 45, 65);
    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));
    expect(await weatherTypicalFor('air_f', 'weekday', 10, 'summer')).toBeFalsy();
    expect(await weatherTypicalFor('air_f', 'weekday', 11, 'summer')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run and verify it fails**

Run: `npm run test:worker -- aggregate`
Expected: FAIL — no `weather_typicals` rows exist.

- [ ] **Step 5: Implement `rebuildWeatherTypicals`**

Add to `src/worker/poller/aggregate.ts`:

```ts
/** Metric column name -> the `metric` value stored in weather_typicals.
 *  Keyed on the DB column so adding a metric is one entry here plus the
 *  column already existing, with no schema change. */
const WEATHER_METRICS = ['air_f', 'surface_f', 'dew_point_f', 'humidity_pct'] as const;

interface WeatherRow {
  capturedAt: string;
  air_f: number | null;
  surface_f: number | null;
  dew_point_f: number | null;
  humidity_pct: number | null;
}

/**
 * Rebuilds `weather_typicals` from the trailing TYPICALS_WINDOW_DAYS of
 * `weather_snapshots`, mirroring `rebuildTypicals`: DELETE everything, then
 * recompute one row per (metric, weekday-class, hour, season) group, with
 * `sample_count` and `distinct_days` alongside the percentiles so the chart
 * can gate its band per bucket.
 *
 * A null reading contributes nothing -- not a zero, and not a row. A bucket
 * with no non-null readings for a metric simply does not exist, which is
 * how the API reports "we have no data for this" rather than claiming a
 * measurement of zero.
 *
 * Collected into the SAME statements array as the route rebuild so both
 * tables land in one `env.DB.batch(...)` transaction -- a concurrent reader
 * must never see one rebuilt and the other half-deleted.
 */
async function weatherTypicalStatements(env: Env, nowMs: number): Promise<D1PreparedStatement[]> {
  const cutoffIso = typicalsCutoffIso(nowMs);
  const rows = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, air_f, surface_f, dew_point_f, humidity_pct
         FROM weather_snapshots WHERE captured_at >= ?`,
    )
      .bind(cutoffIso)
      .all()
  ).results as unknown as WeatherRow[];

  const insert = env.DB.prepare(
    `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75, sample_count, distinct_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const values = new Map<string, number[]>();
  const days = new Map<string, Set<string>>();
  const meta = new Map<string, { metric: string; weekdayClass: string; hour: number; season: string }>();

  for (const row of rows) {
    const capturedMs = Date.parse(row.capturedAt);
    if (!Number.isFinite(capturedMs)) continue; // same defensive skip as the route rebuild
    const { weekdayClass, hour, season } = denverParts(capturedMs);
    const dayKey = denverDateKey(capturedMs);

    for (const metric of WEATHER_METRICS) {
      const reading = row[metric];
      if (reading === null || reading === undefined) continue;
      const key = `${metric}|${weekdayClass}|${hour}|${season}`;
      if (!values.has(key)) {
        values.set(key, []);
        days.set(key, new Set());
        meta.set(key, { metric, weekdayClass, hour, season });
      }
      values.get(key)!.push(reading);
      days.get(key)!.add(dayKey);
    }
  }

  const statements = [env.DB.prepare('DELETE FROM weather_typicals')];
  for (const [key, readings] of values) {
    const m = meta.get(key)!;
    const sorted = [...readings].sort((a, b) => a - b);
    statements.push(
      insert.bind(
        m.metric,
        m.weekdayClass,
        m.hour,
        m.season,
        nearestRank(sorted, 50),
        nearestRank(sorted, 25),
        nearestRank(sorted, 75),
        readings.length,
        days.get(key)!.size,
      ),
    );
  }
  return statements;
}
```

Then wire it into the existing rebuild. In `rebuildTypicals`, change the final line from `await env.DB.batch(statements)` to append the weather statements first:

```ts
  statements.push(...(await weatherTypicalStatements(env, nowMs)));
  await env.DB.batch(statements);
```

**Also update `rebuildTypicals`'s own doc comment.** It currently describes rebuilding `route_typicals` only, and after this change the function rebuilds both tables in one transaction. Say so explicitly, and say why both share the batch: a concurrent reader must never see one table rebuilt while the other is mid-delete. A comment that still claims the function does only half of what it does is the exact defect class caught twice in the `/history` cycle — do not leave it stale. If you judge the function should be renamed to reflect its widened job, that is a reasonable call; update its call site in `runNightly` if you do.

- [ ] **Step 6: Run and verify it passes**

Run: `npm run test:worker -- aggregate`
Expected: PASS, including the pre-existing route-typicals tests.

- [ ] **Step 7: Commit**

```bash
git add src/worker migrations test/worker/aggregate.test.ts
git commit -m "feat(aggregate): build weather_typicals alongside route typicals"
```

---

## Task 3: `GET /api/weather-history`

**Files:**
- Create: `src/worker/api/weather-history.ts`, `test/worker/api-weather-history.test.ts`
- Modify: `src/worker/api/router.ts`, `src/shared/types.ts`

**Interfaces:**
- Consumes: table `weather_typicals` (Task 2); `denverMidnightMs(ms: number): number` from `src/worker/tz.ts`.
- Produces, in `src/shared/types.ts`:

```ts
export type WeatherMetric = 'air_f' | 'surface_f' | 'dew_point_f' | 'humidity_pct';

export interface WeatherTypical {
  metric: WeatherMetric;
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  hour: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  sampleCount: number | null;
  distinctDays: number | null;
}

export interface WeatherHistoryResult {
  typicals: WeatherTypical[];
  today: { capturedAt: string; airF: number | null; surfaceF: number | null }[];
}
```

Plus `getWeatherHistory(env: Env, nowMs?: number): Promise<WeatherHistoryResult>`.

- [ ] **Step 1: Write the failing test**

Create `test/worker/api-weather-history.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api } from '../../src/worker/api/router';
import { getWeatherHistory } from '../../src/worker/api/weather-history';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM weather_typicals').run();
  await env.DB.prepare('DELETE FROM weather_snapshots').run();
});

describe('GET /api/weather-history', () => {
  it('returns typicals for every metric, with confidence fields', async () => {
    await env.DB.prepare(
      `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75, sample_count, distinct_days)
       VALUES ('air_f', 'weekday', 8, 'summer', 50, 45, 55, 30, 5)`,
    ).run();

    const result = await getWeatherHistory(env as any, Date.parse('2026-08-15T18:00:00.000Z'));
    const air = result.typicals.find((t) => t.metric === 'air_f' && t.hour === 8);
    expect(air?.median).toBe(50);
    expect(air?.distinctDays).toBe(5);
  });

  it('reports NULL confidence rather than 0 for a row that predates the columns', async () => {
    await env.DB.prepare(
      `INSERT INTO weather_typicals (metric, weekday_class, hour, season, median, p25, p75)
       VALUES ('air_f', 'weekday', 9, 'summer', 50, 45, 55)`,
    ).run();

    const result = await getWeatherHistory(env as any, Date.parse('2026-08-15T18:00:00.000Z'));
    expect(result.typicals.find((t) => t.hour === 9)?.distinctDays).toBeNull();
  });

  it('today spans Denver-local midnight, not UTC midnight', async () => {
    const now = Date.parse('2026-08-15T18:00:00.000Z'); // 12:00 MDT Aug 15
    // 05:00Z Aug 15 == 23:00 MDT Aug 14 -- same UTC day as `now`, but the
    // PREVIOUS Denver day, so it must be excluded.
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, 40, 60)`,
    )
      .bind('2026-08-15T05:00:00.000Z')
      .run();
    await env.DB.prepare(
      `INSERT INTO weather_snapshots (captured_at, air_f, surface_f) VALUES (?, 55, 75)`,
    )
      .bind('2026-08-15T17:00:00.000Z')
      .run();

    const result = await getWeatherHistory(env as any, now);
    expect(result.today).toHaveLength(1);
    expect(result.today[0].airF).toBe(55);
  });

  it('serves over HTTP with a Cache-Control header', async () => {
    const res = await api.request('/weather-history', {}, env as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeTruthy();
    const body = (await res.json()) as { typicals: unknown[]; today: unknown[] };
    expect(Array.isArray(body.typicals)).toBe(true);
    expect(Array.isArray(body.today)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:worker -- api-weather-history`
Expected: FAIL — cannot resolve `weather-history`.

- [ ] **Step 3: Implement the assembler**

Create `src/worker/api/weather-history.ts`:

```ts
import type { Env } from '../env';
import type { WeatherHistoryResult, WeatherTypical } from '../../shared/types';
import { denverMidnightMs } from '../tz';

interface TodayRow {
  capturedAt: string;
  airF: number | null;
  surfaceF: number | null;
}

/**
 * Assembles `GET /api/weather-history`. Station-wide, so unlike
 * `/api/history` it takes no route parameter -- the Teton Pass RWIS sensor
 * reports one set of readings for the pass, and hanging them off a `?route=`
 * would imply they differ per route.
 *
 * `today` = every `weather_snapshots` row since Denver-local midnight,
 * ascending. Both queries are naturally bounded: `weather_typicals` holds at
 * most ~96 rows per metric, and `today` is one Denver day of 10-minute polls.
 */
export async function getWeatherHistory(
  env: Env,
  nowMs: number = Date.now(),
): Promise<WeatherHistoryResult> {
  const typicals = (
    await env.DB.prepare(
      `SELECT metric, weekday_class AS weekdayClass, hour, season,
              median, p25, p75, sample_count AS sampleCount, distinct_days AS distinctDays
         FROM weather_typicals`,
    ).all()
  ).results as unknown as WeatherTypical[];

  const todayStartIso = new Date(denverMidnightMs(nowMs)).toISOString();
  const today = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, air_f AS airF, surface_f AS surfaceF
         FROM weather_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC`,
    )
      .bind(todayStartIso)
      .all()
  ).results as unknown as TodayRow[];

  return { typicals, today };
}
```

- [ ] **Step 4: Mount the route**

In `src/worker/api/router.ts`, alongside the existing `api.get('/history', ...)`. Match that handler's Cache-Control convention exactly — read it first and mirror it:

```ts
api.get('/weather-history', async (c) => {
  const result = await getWeatherHistory(c.env);
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(result);
});
```

Add the import: `import { getWeatherHistory } from './weather-history';`

- [ ] **Step 5: Run and verify it passes**

Run: `npm run test:worker -- api-weather-history`, then the full `npm run test:worker`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker src/shared/types.ts test/worker/api-weather-history.test.ts
git commit -m "feat(api): add GET /api/weather-history"
```

---

## Task 4: Generalize `TypicalChart` to be unit-agnostic

The riskiest task: it renames fields across ten files of recently-shipped code. The existing chart tests are the safety net — they must all still pass, unchanged in meaning.

**Files:**
- Modify: `src/shared/history.ts`, `src/app/components/TypicalChart.tsx`, `src/app/historyChart.ts`, `src/app/HistoryPage.tsx`, `src/app/components/HomeHistoryCard.tsx`
- Test: `test/parsers/band-runs.test.ts`, `test/app/TypicalChart.test.tsx`, `test/app/historyChart.test.ts`, `test/app/HomeHistoryCard.test.tsx`, `test/app/HistoryPage.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface ChartPoint {
  hour: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  distinctDays: number | null;
}

export interface TypicalChartProps {
  points: ChartPoint[];
  today: { hour: number; value: number }[];
  compact?: boolean;
  formatValue?: (v: number) => string;   // defaults to `${Math.round(v/60)}m`
  secondary?: ChartPoint[];              // median line only, no band
  referenceValue?: { value: number; label: string };
}
```

- `BandPoint` in `src/shared/history.ts` renames `p25Sec`/`p75Sec` → `p25`/`p75`.
- **`HistoryTypical.medianSec` / `p25Sec` / `p75Sec` in `src/shared/types.ts` are NOT renamed** — that is the drive-time API contract and those values genuinely are seconds. Only the chart's own point type changes.

- [ ] **Step 1: Rename `BandPoint`'s fields**

In `src/shared/history.ts`, rename `p25Sec` → `p25` and `p75Sec` → `p75` in the `BandPoint` interface and in `qualifies()`. Update the same names throughout `test/parsers/band-runs.test.ts`.

Run: `npm run test -- band-runs`
Expected: PASS (7 tests), proving the gate logic is unchanged by the rename.

- [ ] **Step 2: Write the failing tests for the new capabilities**

Create `test/app/TempChart.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TypicalChart, { type ChartPoint } from '../../src/app/components/TypicalChart';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';

const OK = MIN_DISTINCT_DAYS_FOR_BAND;

function pt(hour: number, median: number): ChartPoint {
  return { hour, median, p25: median - 5, p75: median + 5, distinctDays: OK };
}

describe('TypicalChart — generalized', () => {
  it('formats the now-label with formatValue instead of minutes', () => {
    render(
      <TypicalChart
        points={[pt(6, 50), pt(7, 52)]}
        today={[{ hour: 6.5, value: 51 }]}
        formatValue={(v) => `${Math.round(v)}°F`}
      />,
    );
    expect(screen.getByText(/now · 51°F/)).toBeTruthy();
  });

  it('defaults to minute formatting when no formatValue is given', () => {
    render(
      <TypicalChart points={[pt(6, 2280), pt(7, 2280)]} today={[{ hour: 6.5, value: 2280 }]} />,
    );
    expect(screen.getByText(/now · 38m/)).toBeTruthy();
  });

  it('draws a secondary median line with no band of its own', () => {
    render(
      <TypicalChart
        points={[pt(6, 50), pt(7, 52)]}
        secondary={[pt(6, 70), pt(7, 72)]}
        today={[]}
      />,
    );
    expect(screen.getByTestId('median-secondary')).toBeTruthy();
    // One band only -- the primary's. The secondary is a bare line.
    expect(screen.getAllByTestId('band')).toHaveLength(1);
  });

  it('includes the secondary series in the y-domain so it cannot be clipped', () => {
    // Surface temp runs well above air in summer. If the domain came from
    // the primary alone, the secondary would render outside the plot area.
    const { container } = render(
      <TypicalChart points={[pt(6, 50), pt(7, 50)]} secondary={[pt(6, 90), pt(7, 90)]} today={[]} />,
    );
    const secondary = screen.getByTestId('median-secondary');
    const ys = (secondary.getAttribute('points') ?? '')
      .split(' ')
      .map((p) => Number(p.split(',')[1]));
    const viewBoxHeight = Number((container.querySelector('svg')?.getAttribute('viewBox') ?? '').split(' ')[3]);
    for (const yVal of ys) {
      expect(yVal).toBeGreaterThanOrEqual(0);
      expect(yVal).toBeLessThanOrEqual(viewBoxHeight);
    }
  });

  it('draws the reference line when the domain reaches it', () => {
    render(
      <TypicalChart
        points={[pt(6, 30), pt(7, 34)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.getByTestId('reference-line')).toBeTruthy();
    expect(screen.getByText('Freezing')).toBeTruthy();
  });

  it('omits the reference line when the data is nowhere near it', () => {
    // An August chart spanning 45-79°F must not be stretched down to 32°F
    // just to draw a freezing line, wasting a third of its height.
    render(
      <TypicalChart
        points={[pt(6, 60), pt(7, 75)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });
});
```

- [ ] **Step 3: Run and verify it fails**

Run: `npm run test:app -- TempChart`
Expected: FAIL — `formatValue` unknown, `median` not a `ChartPoint` field.

- [ ] **Step 4: Perform the rename**

In `src/app/components/TypicalChart.tsx`: rename `medianSec`→`median`, `p25Sec`→`p25`, `p75Sec`→`p75` on `ChartPoint`; rename the `today` element field `durationSec`→`value`; update every use in the body.

In `src/app/historyChart.ts`: `typicalsToChartPoints` maps the API's `medianSec`/`p25Sec`/`p75Sec` (unchanged names on `HistoryTypical`) onto the chart's `median`/`p25`/`p75`. `todayToChartPoints` returns `{ hour, value }` and its return type becomes `{ hour: number; value: number }[]`.

Update `HistoryPage.tsx`, `HomeHistoryCard.tsx`, and the four app test files to match. `npx tsc --noEmit` will enumerate every remaining site.

- [ ] **Step 5: Add the new capabilities**

In `TypicalChart.tsx`:

```ts
const DEFAULT_FORMAT = (v: number) => `${Math.round(v / 60)}m`;
/** How close the data must come to the reference before it is worth drawing.
 *  Beyond this the line would only stretch the domain into empty space. */
const REFERENCE_PROXIMITY = 8;
```

Signature becomes:

```ts
export default function TypicalChart({
  points,
  today,
  compact = false,
  formatValue = DEFAULT_FORMAT,
  secondary = [],
  referenceValue,
}: TypicalChartProps) {
```

The `values` array must include the secondary series and, conditionally, the reference:

```ts
  const dataValues = [
    ...points.flatMap((p) => [p.median, p.p25, p.p75]),
    ...secondary.flatMap((p) => [p.median, p.p25, p.p75]),
    ...today.map((t) => t.value),
  ].filter((v): v is number => v !== null);

  if (dataValues.length === 0) return NO_HISTORY;

  // The reference only joins the domain when the data already comes near it
  // -- otherwise a 45-79°F summer chart would be stretched down to 32°F.
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);
  const showReference =
    referenceValue !== undefined &&
    referenceValue.value >= dataMin - REFERENCE_PROXIMITY &&
    referenceValue.value <= dataMax + REFERENCE_PROXIMITY;
  const values = showReference ? [...dataValues, referenceValue.value] : dataValues;
```

with `vMin`/`vMax`/`span` derived from `values` as before. The x-domain likewise must include the secondary series' hours.

Render the secondary line after the primary median, before `today`:

```tsx
      {secondaryPts && (
        <polyline
          data-testid="median-secondary"
          points={secondaryPts}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
      )}
```

and the reference rule before everything else so the series paint over it:

```tsx
      {showReference && referenceValue && (
        <>
          <line
            data-testid="reference-line"
            x1={PAD.left}
            y1={y(referenceValue.value)}
            x2={VB_W - PAD.right}
            y2={y(referenceValue.value)}
            stroke="var(--color-faint)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
          <text
            x={PAD.left + 4}
            y={y(referenceValue.value) - 4}
            fontSize="10"
            fill="var(--color-faint)"
          >
            {referenceValue.label}
          </text>
        </>
      )}
```

Update the now-label to `{`now · ${formatValue(last.value)}`}`.

- [ ] **Step 6: Run everything**

Run: `npm run test`, `npm run test:app`, `npx tsc --noEmit`
Expected: all PASS. The pre-existing `TypicalChart.test.tsx` tests must pass with only field renames — if any assertion had to change *meaning*, the rename broke behavior; stop and investigate.

- [ ] **Step 7: Commit**

```bash
git add src test
git commit -m "refactor(chart): make TypicalChart unit-agnostic with secondary series"
```

---

## Task 5: Temperature units

**Files:**
- Create: `src/app/units.ts`, `src/app/components/TempUnitToggle.tsx`, `test/app/units.test.ts`
- Modify: `src/app/components/WeatherStrip.tsx`, `test/app/WeatherStrip.test.tsx`

**Interfaces:**
- Produces:
```ts
export type TempUnit = 'F' | 'C';
export function fToC(f: number): number;
export function formatTemp(f: number, unit: TempUnit): string;  // "50°F" / "10°C"
export function useTempUnit(): { unit: TempUnit; setUnit: (u: TempUnit) => void };
```

- [ ] **Step 1: Write the failing test**

Create `test/app/units.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fToC, formatTemp, useTempUnit } from '../../src/app/units';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('fToC', () => {
  it('converts freezing and boiling exactly', () => {
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBe(100);
  });

  it('handles temperatures below zero Fahrenheit', () => {
    // -40 is the one point where the scales agree.
    expect(fToC(-40)).toBe(-40);
  });
});

describe('formatTemp', () => {
  it('rounds to a whole degree in both units', () => {
    expect(formatTemp(50, 'F')).toBe('50°F');
    expect(formatTemp(50, 'C')).toBe('10°C'); // 10.0
    expect(formatTemp(70, 'C')).toBe('21°C'); // 21.1 rounds down
  });
});

describe('useTempUnit', () => {
  it('defaults to Fahrenheit', () => {
    const { result } = renderHook(() => useTempUnit());
    expect(result.current.unit).toBe('F');
  });

  it('persists the choice across a remount', () => {
    const first = renderHook(() => useTempUnit());
    act(() => first.result.current.setUnit('C'));
    first.unmount();

    const second = renderHook(() => useTempUnit());
    expect(second.result.current.unit).toBe('C');
  });

  it('degrades to the default instead of throwing when localStorage is unavailable', () => {
    // Private browsing / disabled storage. Same failure mode deviceId.ts
    // already guards against -- a unit preference must never crash a page.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { result } = renderHook(() => useTempUnit());
    expect(result.current.unit).toBe('F');
    expect(() => act(() => result.current.setUnit('C'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:app -- units`
Expected: FAIL — cannot resolve `src/app/units`.

- [ ] **Step 3: Implement**

Create `src/app/units.ts`:

```ts
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'temp-unit';

export type TempUnit = 'F' | 'C';

/** Exact conversion. Temperatures are STORED in Fahrenheit only -- WYDOT
 *  reports whole degrees F and its own parenthesized Celsius is a rounded
 *  conversion of an already-rounded number, so deriving C here is strictly
 *  more accurate than persisting theirs. */
export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function formatTemp(f: number, unit: TempUnit): string {
  return unit === 'C' ? `${Math.round(fToC(f))}°C` : `${Math.round(f)}°F`;
}

function readStored(): TempUnit {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'C' ? 'C' : 'F';
  } catch {
    return 'F';
  }
}

/**
 * The site-wide temperature unit preference. Defaults to Fahrenheit for a
 * Wyoming/Idaho audience. Persisted in `localStorage` behind the same
 * try/catch `deviceId.ts` uses -- private browsing, disabled storage, and
 * quota errors all degrade to "this session uses the default" rather than
 * crashing a page over a display preference.
 */
export function useTempUnit(): { unit: TempUnit; setUnit: (u: TempUnit) => void } {
  const [unit, setUnitState] = useState<TempUnit>(readStored);

  const setUnit = useCallback((u: TempUnit) => {
    setUnitState(u);
    try {
      localStorage.setItem(STORAGE_KEY, u);
    } catch {
      // Preference simply won't survive this session. Not worth surfacing.
    }
  }, []);

  return { unit, setUnit };
}
```

Create `src/app/components/TempUnitToggle.tsx`:

```tsx
import type { TempUnit } from '../units';

export default function TempUnitToggle({
  unit,
  onChange,
}: {
  unit: TempUnit;
  onChange: (u: TempUnit) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Temperature unit">
      {(['F', 'C'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          aria-pressed={unit === u}
          className={
            unit === u
              ? 'bg-btn-bg text-btn-ink rounded-full px-2.5 py-1 text-[11px] font-bold'
              : 'text-muted rounded-full px-2.5 py-1 text-[11px]'
          }
        >
          °{u}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Adopt it in `WeatherStrip`**

Add a failing test to `test/app/WeatherStrip.test.tsx` first:

```tsx
it('renders temperatures in Celsius when the unit is C', () => {
  render(<WeatherStrip weather={reading} unit="C" now={new Date('2026-01-15T12:00:00.000Z')} />);
  // reading.airF is 28 -> -2°C, surfaceF is 22 -> -6°C
  expect(screen.getByText('-2°C')).toBeInTheDocument();
  expect(screen.getByText('-6°C')).toBeInTheDocument();
});

it('defaults to Fahrenheit when no unit is supplied', () => {
  render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
  expect(screen.getByText('28°F')).toBeInTheDocument();
});
```

Then add a `unit?: TempUnit` prop (defaulting to `'F'`) and replace the two hardcoded `°F` template strings at the `airTile`/`roadTile` definitions with `formatTemp(weather.airF, unit)` and `formatTemp(weather.surfaceF, unit)`.

- [ ] **Step 5: Run and verify**

Run: `npm run test:app`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app test/app
git commit -m "feat(app): add site-wide temperature unit preference"
```

---

## Task 6: The temp chart section on /history

**Files:**
- Create: `src/app/weatherHistoryApi.ts`
- Modify: `src/app/HistoryPage.tsx`, `src/app/App.tsx`
- Test: `test/app/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `getWeatherHistory` shape from Task 3; `TypicalChart`'s `secondary`/`formatValue`/`referenceValue` from Task 4; `useTempUnit`/`formatTemp`/`TempUnitToggle` from Task 5; `denverNow` from `src/app/historyChart.ts`.

- [ ] **Step 1: Write the fetch client**

Create `src/app/weatherHistoryApi.ts`:

```ts
import type { WeatherHistoryResult } from '../shared/types';

const FETCH_TIMEOUT_MS = 15_000;

/** Reads our own /api/weather-history. Mirrors historyApi.ts's timeout guard. */
export async function getWeatherHistory(): Promise<WeatherHistoryResult> {
  const res = await fetch('/api/weather-history', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/weather-history failed with ${res.status}`);
  return (await res.json()) as WeatherHistoryResult;
}
```

- [ ] **Step 2: Write the failing test**

Add to `test/app/HistoryPage.test.tsx`. Extend the existing `stubApi` helper to also answer `/api/weather-history`; follow that file's existing mocking style:

```tsx
it('plots air and surface temp for the current population only', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, summer
  stubApiWithWeather({
    typicals: [
      // Matching population (weekend/summer) -- these plot.
      { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
      { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 55, p25: 50, p75: 60, sampleCount: 30, distinctDays: 9 },
      { metric: 'surface_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 70, p25: 65, p75: 75, sampleCount: 30, distinctDays: 9 },
      { metric: 'surface_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 75, p25: 70, p75: 80, sampleCount: 30, distinctDays: 9 },
      // Wrong population -- must NOT plot. Same failure mode as the /history
      // Critical bug: two populations at one x-coordinate.
      { metric: 'air_f', weekdayClass: 'weekday', season: 'summer', hour: 8, median: 20, p25: 15, p75: 25, sampleCount: 30, distinctDays: 9 },
      { metric: 'air_f', weekdayClass: 'weekend', season: 'winter', hour: 8, median: 10, p25: 5, p75: 15, sampleCount: 30, distinctDays: 9 },
    ],
    today: [],
  });

  render(<HistoryPage />);
  const card = await screen.findByTestId('temp-card');
  const primary = within(card).getByTestId('median');
  // Two hours plotted, not four -- the weekday and winter rows must be
  // filtered out, not drawn at the same x-coordinates as the weekend/summer
  // ones. This is the same failure the /history Critical bug produced.
  expect((primary.getAttribute('points') ?? '').trim().split(' ')).toHaveLength(2);
  expect(within(card).getByTestId('median-secondary')).toBeTruthy();
});

it('switches the temp chart to Celsius when the unit toggle is used', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z'));
  stubApiWithWeather({
    typicals: [
      { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 8, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
      { metric: 'air_f', weekdayClass: 'weekend', season: 'summer', hour: 9, median: 50, p25: 45, p75: 55, sampleCount: 30, distinctDays: 9 },
    ],
    today: [{ capturedAt: '2026-08-15T15:00:00.000Z', airF: 50, surfaceF: 70 }],
  });

  render(<HistoryPage />);
  expect(await screen.findByText(/now · 50°F/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '°C' }));
  expect(await screen.findByText(/now · 10°C/)).toBeTruthy();
});
```

- [ ] **Step 3: Run and verify it fails**

Run: `npm run test:app -- HistoryPage`
Expected: FAIL — no temp chart rendered.

- [ ] **Step 4: Add the section to `HistoryPage`**

Fetch weather history once on mount (it takes no route parameter, so it does not belong in the per-slug effect). Derive `weekdayClass`/`season` from the existing `denverNow()` call already in the component, and filter the typicals by metric AND population:

```ts
function tempPoints(
  typicals: WeatherTypical[],
  metric: WeatherMetric,
  weekdayClass: 'weekday' | 'weekend',
  season: 'winter' | 'summer',
): ChartPoint[] {
  return typicals
    .filter((t) => t.metric === metric && t.weekdayClass === weekdayClass && t.season === season)
    .sort((a, b) => a.hour - b.hour)
    .map((t) => ({
      hour: t.hour,
      median: t.median,
      p25: t.p25,
      p75: t.p75,
      distinctDays: t.distinctDays,
    }));
}
```

Render below the existing drive-time card. **There will now be two `TypicalChart`s on this page**, so a bare `getByTestId('median')` becomes ambiguous. Put `data-testid="temp-card"` on the temp section's wrapper and have the tests scope their queries with `within(screen.getByTestId('temp-card'))` rather than adding a testid-prefix prop to the chart. Update the two tests in Step 2 accordingly — `within(...).getByTestId('median')` for the primary line and `within(...).getByTestId('median-secondary')` for surface.

Card contents:

- primary = `tempPoints(..., 'air_f', ...)`
- `secondary` = `tempPoints(..., 'surface_f', ...)`
- `today` = weather `today` mapped to `{ hour: denverFractionalHourOf(r.capturedAt), value: r.airF }`, skipping null `airF`
- `formatValue` = `(v) => formatTemp(v, unit)`
- `referenceValue` = `{ value: 32, label: 'Freezing' }`
- a `<TempUnitToggle>` in the card header
- a legend naming the two lines, and the same "band shown only where we have enough separate days" caption the drive-time card carries

- [ ] **Step 5: Wire the unit into the home page**

In `App.tsx`, call `useTempUnit()` and pass `unit` to `WeatherStrip`, and render a `<TempUnitToggle>` near it so the preference is reachable from the home page too.

- [ ] **Step 6: Run everything**

Run: `npm run test:app`, then `npm run build`.
Expected: PASS, and `dist/history.html` still emitted at the dist root.

- [ ] **Step 7: Commit**

```bash
git add src/app test/app
git commit -m "feat(app): add the historic temperature chart to /history"
```

---

## Task 7: Full verification

- [ ] **Step 1: All three suites**

```bash
npm run test && npm run test:worker && npm run test:app && npx tsc --noEmit
```
Do not proceed past a failure.

- [ ] **Step 2: Build**

Run: `npm run build` — confirm `dist/history.html` is at the dist ROOT, not nested.

- [ ] **Step 3: Launch checks**

Start `npm run dev`, then `scripts/verify-launch.sh http://localhost:8787 --skip-writes`.
Expected: all PASS.

- [ ] **Step 4: End-to-end against real data**

With `wrangler dev` running:
- Trigger a poll cycle: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*%2F10+11-23+*+*+*"`
- Confirm the new sensors landed:
  `npx wrangler d1 execute tetonpasscam --local --command "SELECT air_f, surface_f, humidity_pct, dew_point_f FROM weather_snapshots ORDER BY captured_at DESC LIMIT 1"`
  Expected: all four non-null.
- Trigger the nightly job: `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=10+9+*+*+*"`
- Inspect the aggregation:
  `npx wrangler d1 execute tetonpasscam --local --command "SELECT metric, COUNT(*) n, MAX(distinct_days) d FROM weather_typicals GROUP BY metric"`
  Expected: rows for `air_f` and `surface_f` at minimum.
- Fetch `curl -s localhost:8787/api/weather-history | head -c 400` and confirm both typicals and today are populated.

Report the actual output of each.

- [ ] **Step 5: Report**

Note whether the freezing line renders (it should NOT in August — summer temps are far above 32°F, and the conditional is designed to omit it) and the real `distinct_days` distribution for weather buckets, which is the first measurement of whether the threshold of 4 suits weather as well as it suits travel times.

---

## Deferred

- Charting humidity or dew point — captured from Task 1, drawn never (this cycle).
- A derived frost-risk indicator from dew point vs surface temp.
- Re-tuning `MIN_DISTINCT_DAYS_FOR_BAND` against real weather bucket counts.
