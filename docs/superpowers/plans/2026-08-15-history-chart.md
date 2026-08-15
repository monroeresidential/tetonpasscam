# History Typical-Band Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/history` page from design mock 2c — travel time by hour of day, today's line against a typical p25–p75 band that is withheld per-hour where the data can't support it — plus a compact clickable version on the home page.

**Architecture:** A new `sample_count`/`distinct_days` column pair on `route_typicals` (written by the existing nightly `rebuildTypicals`) lets the client gate the band per-bucket. `/api/history` grows those fields plus a nullable `summary` object feeding two tables. The page is a 4th vite entry (`history.html`) with its own React root and SEO head, following the `admin.html`/`embed.html` precedent. The chart is hand-rolled SVG using `index.css` design tokens — no charting library.

**Tech Stack:** React 19 + Vite (multi-page), Hono on Cloudflare Workers, D1 + drizzle-kit, Tailwind v4 (`@theme` tokens), Vitest (three configs: parsers/node, worker/workers-pool, app/jsdom).

**Spec:** `docs/superpowers/specs/2026-08-15-history-chart-design.md`

## Global Constraints

- **Migrations are append-only.** `0000_polite_blur.sql` and `0001_mysterious_masked_marvel.sql` are applied to remote D1 and frozen. Never edit them; always `npm run db:generate` a new `000N_*.sql`. (CLAUDE.md, `docs/RUNBOOK.md` §1)
- **Band gate keys on `distinct_days`, never `sample_count`.** Constant: `MIN_DISTINCT_DAYS_FOR_BAND = 4`.
- **`NULL` `distinct_days` means "no band"** — never "band allowed". Pre-rebuild rows are `NULL`.
- **No invented display content.** Worst-days rows are date + peak only; no "storm + crash" reason inference. (CLAUDE.md hard rule 5)
- **All chart colors come from `src/app/index.css` `@theme` tokens** — never hardcoded hex. The mock is light-only; the app ships a `prefers-color-scheme: dark` token set.
- **Season and weekday-class are derived from the clock, never hardcoded.** The mock says "winter Saturday"; it is currently summer.
- **Clients only ever read our own API.** (CLAUDE.md)
- **Denver-local, DST-aware.** All date/hour/season derivation goes through `src/worker/tz.ts`. Never group by UTC date.
- **No charting library.** Lighthouse mobile ≥ 90 is a P1 DoD item.

---

## File Structure

**Create:**
- `src/shared/history.ts` — `MIN_DISTINCT_DAYS_FOR_BAND`, `bandRuns()`. Shared by worker and app; pure, no imports from either side.
- `src/app/history.html` — 4th vite entry, own SEO head.
- `src/app/history.tsx` — React entry for that page.
- `src/app/HistoryPage.tsx` — page shell: tabs, flip, data fetch.
- `src/app/components/TypicalChart.tsx` — the SVG chart.
- `src/app/components/WorstDays.tsx` — table + empty state.
- `src/app/components/SeasonCompare.tsx` — table + empty state.
- `src/app/historyApi.ts` — `getHistory()` fetch client.
- `test/app/TypicalChart.test.tsx`, `test/app/HistoryTables.test.tsx`
- `test/parsers/band-runs.test.ts` — pure function, fast node suite.

**Modify:**
- `src/worker/tz.ts` — add `denverDateKey()`, `denverSeasonStartMs()`.
- `src/worker/db/schema.ts:40-58` — two columns on `routeTypicals`.
- `src/worker/poller/aggregate.ts` — populate them.
- `src/shared/types.ts` — `HistoryTypical`, `HistorySummary`, `HistoryResult` move here from the worker.
- `src/worker/api/history.ts` — new fields + `summary`.
- `vite.config.ts:200-204` — 4th input.
- `src/app/App.tsx` — compact chart card + link.
- `test/worker/aggregate.test.ts`, `test/worker/api-history.test.ts`, `test/parsers/tz.test.ts`

---

## Task 1: Denver date-key and season-start helpers

`tz.ts` can already derive hour/weekday-class/season and local midnight, but has no "which calendar day is this" key and no "when did the current season start". Both are needed for per-day grouping and season scoping.

**Files:**
- Modify: `src/worker/tz.ts`
- Test: `test/parsers/tz.test.ts`

**Interfaces:**
- Consumes: existing `DENVER_PARTS_FORMAT`, `denverParts`, `getDenverOffsetMinutes` in `src/worker/tz.ts`.
- Produces:
  - `denverDateKey(ms: number): string` — `'YYYY-MM-DD'` in America/Denver.
  - `denverSeasonStartMs(ms: number): number` — UTC epoch ms of Denver-local midnight on the first day of the season containing `ms`. Summer starts May 1; winter starts Nov 1 (of the previous calendar year when the instant falls in Jan–Apr).

- [ ] **Step 1: Write the failing tests**

Append to `test/parsers/tz.test.ts`:

```ts
import { denverDateKey, denverSeasonStartMs } from '../../src/worker/tz';

describe('denverDateKey', () => {
  it('zero-pads month and day', () => {
    // 2026-08-15T18:00:00Z == 12:00 MDT the same day
    expect(denverDateKey(Date.parse('2026-08-15T18:00:00.000Z'))).toBe('2026-08-15');
    expect(denverDateKey(Date.parse('2026-01-05T19:00:00.000Z'))).toBe('2026-01-05');
  });

  it('uses the Denver day, not the UTC day', () => {
    // 2026-08-16T04:00:00Z is 22:00 MDT on Aug 15 -- UTC has already
    // rolled over, Denver has not. Grouping by UTC here would split one
    // evening's readings across two "days".
    expect(denverDateKey(Date.parse('2026-08-16T04:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('denverSeasonStartMs', () => {
  it('summer instant => May 1 of the same year, Denver midnight', () => {
    const start = denverSeasonStartMs(Date.parse('2026-08-15T18:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2026-05-01');
  });

  it('Nov-Dec winter instant => Nov 1 of the same year', () => {
    const start = denverSeasonStartMs(Date.parse('2026-12-20T19:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2026-11-01');
  });

  it('Jan-Apr winter instant => Nov 1 of the PREVIOUS year', () => {
    // The winter season spans the year boundary; a February instant
    // belongs to the season that began the previous November.
    const start = denverSeasonStartMs(Date.parse('2026-02-10T19:00:00.000Z'));
    expect(denverDateKey(start)).toBe('2025-11-01');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test -- tz`
Expected: FAIL — `denverDateKey is not a function`.

- [ ] **Step 3: Implement**

Append to `src/worker/tz.ts`:

```ts
/**
 * 'YYYY-MM-DD' for the America/Denver calendar day containing `ms`. Used to
 * group readings by local day (aggregate.ts's distinct-day count, and
 * history.ts's per-day peaks). Deliberately NOT `toISOString().slice(0,10)`
 * -- that is the UTC day, which splits a Denver evening across two keys.
 */
export function denverDateKey(ms: number): string {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = get('year');
  const m = get('month').padStart(2, '0');
  const d = get('day').padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Denver-local midnight on the first day of the season containing `ms`,
 * matching `denverParts`'s Nov-Apr = winter / May-Oct = summer split.
 * Winter spans the year boundary, so a Jan-Apr instant belongs to the
 * season that began the PREVIOUS November.
 */
export function denverSeasonStartMs(ms: number): number {
  const parts = DENVER_PARTS_FORMAT.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const year = get('year');
  const month = get('month'); // 1-12

  const startYear = month >= 1 && month <= 4 ? year - 1 : year;
  const startMonth = month >= 5 && month <= 10 ? 5 : 11;
  // Noon avoids any DST edge at the boundary date; denverMidnightMs then
  // walks back to that Denver day's true local midnight.
  return denverMidnightMs(Date.UTC(startYear, startMonth - 1, 1, 12, 0, 0));
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test -- tz`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/tz.ts test/parsers/tz.test.ts
git commit -m "feat(tz): add denverDateKey and denverSeasonStartMs helpers"
```

---

## Task 2: Migration — sample_count and distinct_days

**Files:**
- Modify: `src/worker/db/schema.ts:40-58`
- Create: `migrations/0002_*.sql` (drizzle-kit names it; do not hand-write)

**Interfaces:**
- Produces: `route_typicals.sample_count`, `route_typicals.distinct_days` — both nullable INTEGER. Task 3 writes them; Task 5 reads them.

- [ ] **Step 1: Add the columns to the drizzle schema**

In `src/worker/db/schema.ts`, inside the `routeTypicals` column object, after `p75Sec`:

```ts
    p75Sec: integer('p75_sec'),
    // Confidence inputs for the /history band gate. Nullable because rows
    // written before migration 0002 have neither -- the client treats NULL
    // as "no band", so the pre-rebuild window degrades to median-only
    // rather than drawing a band it cannot justify. rebuildTypicals does a
    // full DELETE + rebuild nightly, so NULLs disappear after one run.
    sampleCount: integer('sample_count'),
    // Distinct America/Denver calendar days contributing to this bucket.
    // This -- not sampleCount -- is what the band gate keys on: 30 samples
    // at 8 AM is really 5 days x 6 polls, and within-hour spread is not the
    // day-to-day spread a "typical band" claims to show.
    distinctDays: integer('distinct_days'),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `migrations/0002_<adjective>_<name>.sql` containing two `ALTER TABLE route_typicals ADD ...` statements.

- [ ] **Step 3: Verify 0000 and 0001 are untouched**

Run: `git status --short migrations/`
Expected: exactly one new untracked `0002_*.sql`. If `0000_polite_blur.sql` or `0001_mysterious_masked_marvel.sql` show as modified, **stop** — revert them and investigate; those are frozen on remote D1.

- [ ] **Step 4: Apply locally**

Run: `npm run db:migrate:local`
Expected: applies `0002_*.sql` with no error.

- [ ] **Step 5: Commit**

```bash
git add src/worker/db/schema.ts migrations/
git commit -m "feat(db): add sample_count and distinct_days to route_typicals"
```

---

## Task 3: Populate the confidence columns in the nightly rebuild

**Files:**
- Modify: `src/worker/poller/aggregate.ts`
- Test: `test/worker/aggregate.test.ts`

**Interfaces:**
- Consumes: `denverDateKey` (Task 1); `sample_count`/`distinct_days` columns (Task 2).
- Produces: every `route_typicals` row written by `rebuildTypicals` carries a non-null `sampleCount` and `distinctDays`.

- [ ] **Step 1: Write the failing test**

Add to `test/worker/aggregate.test.ts`. Note the existing `typicalsFor` helper only selects three columns — add a second helper rather than changing it, so existing assertions stay untouched:

```ts
async function confidenceFor(
  routeId_: number,
  weekdayClass: string,
  hour: number,
  season: string,
): Promise<{ sampleCount: number; distinctDays: number } | undefined> {
  return (await env.DB.prepare(
    `SELECT sample_count AS sampleCount, distinct_days AS distinctDays
       FROM route_typicals WHERE route_id = ? AND weekday_class = ? AND hour = ? AND season = ?`,
  )
    .bind(routeId_, weekdayClass, hour, season)
    .first()) as { sampleCount: number; distinctDays: number } | undefined;
}

// Slug choice matters: runNightly rebuilds EVERY route from EVERY
// travel_times row in the shared test DB, so a slug another test in this
// file already seeded would inflate these counts. driggs-airport-{eb,wb}
// are the only pair untouched by the existing tests here.
describe('runNightly — confidence columns', () => {
  it('counts samples and DISTINCT Denver days separately', async () => {
    const id = await routeId('driggs-airport-eb');
    // Six readings in the 08:00 MDT hour, but spread over only TWO Denver
    // days: 2026-08-11 (Tue) and 2026-08-12 (Wed). This is exactly the
    // shape the gate exists to catch -- a healthy-looking sample count
    // standing on almost no day-to-day evidence.
    // 14:00 UTC == 08:00 MDT (UTC-6) in August.
    for (const min of ['00', '10', '20']) {
      await insertTravelTime(id, `2026-08-11T14:${min}:00.000Z`, 1800);
      await insertTravelTime(id, `2026-08-12T14:${min}:00.000Z`, 1900);
    }

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const conf = await confidenceFor(id, 'weekday', 8, 'summer');
    expect(conf?.sampleCount).toBe(6);
    expect(conf?.distinctDays).toBe(2);
  });

  it('counts a Denver day, not a UTC day', async () => {
    const id = await routeId('driggs-airport-wb');
    // Both readings are 22:00 MDT on 2026-08-11 -- but the second one is
    // 2026-08-12 in UTC. Grouping by UTC would report 2 distinct days.
    await insertTravelTime(id, '2026-08-12T03:50:00.000Z', 2000);
    await insertTravelTime(id, '2026-08-12T04:00:00.000Z', 2100);

    await runNightly(env, Date.parse('2026-08-13T15:00:00.000Z'));

    const conf = await confidenceFor(id, 'weekday', 22, 'summer');
    expect(conf?.sampleCount).toBe(2);
    expect(conf?.distinctDays).toBe(1);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:worker -- aggregate`
Expected: FAIL — `sampleCount` is `null` (column exists but nothing writes it).

- [ ] **Step 3: Implement**

In `src/worker/poller/aggregate.ts`:

Extend the import:

```ts
import { denverDateKey, denverParts } from '../tz';
```

Widen the INSERT to nine columns:

```ts
  const insert = env.DB.prepare(
    `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
```

Inside the per-route loop, add a day-set map next to the existing `groups`/`groupMeta`:

```ts
    const groups = new Map<string, number[]>();
    const groupMeta = new Map<string, TypicalGroupMeta>();
    // Distinct Denver days per group. Kept as a parallel Map (rather than
    // widening `groups`) so the existing percentile path is untouched.
    const groupDays = new Map<string, Set<string>>();
```

In the row loop, initialise and populate it — `capturedMs` is already parsed and validated above:

```ts
      if (!groups.has(key)) {
        groups.set(key, []);
        groupMeta.set(key, { weekdayClass, hour, season });
        groupDays.set(key, new Set());
      }
      groups.get(key)!.push(row.durationSec);
      groupDays.get(key)!.add(denverDateKey(capturedMs));
```

In the statement loop, bind the two new values:

```ts
      statements.push(
        insert.bind(
          routeId,
          meta.weekdayClass,
          meta.hour,
          meta.season,
          nearestRank(sorted, 50),
          nearestRank(sorted, 25),
          nearestRank(sorted, 75),
          durations.length,
          groupDays.get(key)!.size,
        ),
      );
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test:worker -- aggregate`
Expected: PASS, including the pre-existing nearest-rank tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker/poller/aggregate.ts test/worker/aggregate.test.ts
git commit -m "feat(aggregate): record sample_count and distinct_days per typicals bucket"
```

---

## Task 4: Shared band-gate constant and run segmentation

The chart must break the band around sub-threshold hours and resume — not interpolate across them. That segmentation is pure logic, so it lives in `src/shared/` and gets tested in the fast node suite.

**Files:**
- Create: `src/shared/history.ts`
- Test: `test/parsers/band-runs.test.ts`

**Interfaces:**
- Produces:
  - `MIN_DISTINCT_DAYS_FOR_BAND = 4`
  - `interface BandPoint { hour: number; p25Sec: number | null; p75Sec: number | null; distinctDays: number | null }`
  - `bandRuns<T extends BandPoint>(points: T[]): T[][]` — maximal runs of **consecutive-by-hour** points that qualify for a band. Runs of length 1 are dropped (a polygon needs two points).

- [ ] **Step 1: Write the failing test**

Create `test/parsers/band-runs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MIN_DISTINCT_DAYS_FOR_BAND, bandRuns, type BandPoint } from '../../src/shared/history';

function pt(hour: number, distinctDays: number | null): BandPoint {
  return { hour, p25Sec: 1700, p75Sec: 1900, distinctDays };
}

describe('bandRuns', () => {
  it('returns one run when every point qualifies', () => {
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(8, 9)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].map((p) => p.hour)).toEqual([6, 7, 8]);
  });

  it('splits around a sub-threshold hour instead of interpolating across it', () => {
    // Hour 8 is thin -- the band must stop at 7 and restart at 9, never
    // spanning 7->9 as though hour 8 were measured.
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(8, 1), pt(9, 9), pt(10, 9)]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([
      [6, 7],
      [9, 10],
    ]);
  });

  it('splits on an hour GAP even when both sides qualify', () => {
    // Hours 6,7 then 11,12 -- nothing measured between. A polygon spanning
    // 7->11 would invent four hours of band.
    const runs = bandRuns([pt(6, 9), pt(7, 9), pt(11, 9), pt(12, 9)]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([
      [6, 7],
      [11, 12],
    ]);
  });

  it('treats NULL distinctDays as not qualifying', () => {
    // Rows written before migration 0002. NULL must never mean "allowed".
    expect(bandRuns([pt(6, null), pt(7, null)])).toEqual([]);
  });

  it('drops single-point runs -- a polygon needs two points', () => {
    expect(bandRuns([pt(6, 1), pt(7, 9), pt(8, 1)])).toEqual([]);
  });

  it('requires non-null p25 and p75, not just enough days', () => {
    const runs = bandRuns([
      { hour: 6, p25Sec: null, p75Sec: 1900, distinctDays: 9 },
      { hour: 7, p25Sec: 1700, p75Sec: 1900, distinctDays: 9 },
      { hour: 8, p25Sec: 1700, p75Sec: 1900, distinctDays: 9 },
    ]);
    expect(runs.map((r) => r.map((p) => p.hour))).toEqual([[7, 8]]);
  });

  it('gates exactly at the threshold', () => {
    const at = MIN_DISTINCT_DAYS_FOR_BAND;
    expect(bandRuns([pt(6, at), pt(7, at)])).toHaveLength(1);
    expect(bandRuns([pt(6, at - 1), pt(7, at - 1)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test -- band-runs`
Expected: FAIL — cannot resolve `src/shared/history`.

- [ ] **Step 3: Implement**

Create `src/shared/history.ts`:

```ts
/**
 * How many distinct America/Denver calendar days a (route, weekday-class,
 * hour, season) bucket needs before /history will draw a p25-p75 band for
 * it. Gates on DAYS, not sample count: the poller runs every 10 minutes for
 * most of the day, so a single day contributes ~6 samples to an hour bucket
 * -- a 30-sample bucket can be just 5 days, and within-hour spread is not
 * the day-to-day spread a "typical band" claims to show.
 *
 * Consequence, accepted deliberately (see the design doc): weekend buckets
 * accrue only 2 distinct days per week, so weekend bands do not appear
 * until roughly two weeks of history. This constant is the single lever if
 * that turns out too strict.
 */
export const MIN_DISTINCT_DAYS_FOR_BAND = 4;

export interface BandPoint {
  hour: number;
  p25Sec: number | null;
  p75Sec: number | null;
  /** NULL for rows written before migration 0002 -- treated as NOT qualifying. */
  distinctDays: number | null;
}

function qualifies(p: BandPoint): boolean {
  return (
    p.p25Sec !== null &&
    p.p75Sec !== null &&
    p.distinctDays !== null &&
    p.distinctDays >= MIN_DISTINCT_DAYS_FOR_BAND
  );
}

/**
 * Split `points` (ascending by hour) into maximal runs that can be drawn as
 * one band polygon: every point qualifies AND the hours are contiguous.
 *
 * Both breaks matter. A sub-threshold hour must interrupt the band rather
 * than being spanned, and so must a missing hour -- a polygon drawn from
 * hour 7 straight to hour 11 would render four hours of band we never
 * measured. Runs shorter than two points are dropped, since a single point
 * has no polygon.
 */
export function bandRuns<T extends BandPoint>(points: T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];

  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };

  for (const p of points) {
    if (!qualifies(p)) {
      flush();
      continue;
    }
    const prev = current[current.length - 1];
    if (prev && p.hour !== prev.hour + 1) flush();
    current.push(p);
  }
  flush();

  return runs;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test -- band-runs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/history.ts test/parsers/band-runs.test.ts
git commit -m "feat(shared): add band gate constant and run segmentation"
```

---

## Task 5: Extend /api/history with confidence fields and summary

**Files:**
- Modify: `src/shared/types.ts`, `src/worker/api/history.ts`
- Test: `test/worker/api-history.test.ts`

**Interfaces:**
- Consumes: `denverDateKey`, `denverSeasonStartMs` (Task 1); `nearestRank` (already exported from `aggregate.ts`); the new columns (Task 3).
- Produces, in `src/shared/types.ts` (moved out of the worker so the app can import them):

```ts
export interface HistoryTypical {
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
  sampleCount: number | null;
  distinctDays: number | null;
}

export interface HistorySummary {
  worstDays: { date: string; peakSec: number }[] | null;
  seasonMedians: { summer: number | null; winter: number | null } | null;
  closureDays: { winter: number | null } | null;
}

export interface HistoryToday {
  capturedAt: string;
  durationSec: number;
}

export interface HistoryResult {
  route: { slug: string; name: string };
  typicals: HistoryTypical[];
  today: HistoryToday[];
  summary: HistorySummary;
}
```

`src/worker/api/history.ts` re-exports these (`export type { HistoryResult } from '../../shared/types'`) so existing importers keep working.

- [ ] **Step 1: Write the failing tests**

Add to `test/worker/api-history.test.ts`. That file has a `routeId` helper but **no** `insertTravelTime` — add one first (same shape as the one in `aggregate.test.ts`):

```ts
async function insertTravelTime(routeId_: number, capturedAt: string, durationSec: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO travel_times (route_id, captured_at, duration_sec) VALUES (?, ?, ?)`,
  )
    .bind(routeId_, capturedAt, durationSec)
    .run();
}
```

Then the tests — each uses a distinct route slug so they cannot contaminate each other through the file-shared D1:

```ts
describe('GET /api/history — confidence fields', () => {
  it('passes sampleCount and distinctDays through per typical', async () => {
    // driggs-tetonvillage-eb, victor-airport-wb, and victor-tetonvillage-eb
    // are already seeded by the existing tests in this file -- storage
    // persists across tests within a file, so reusing them would mix their
    // route_typicals rows into these assertions.
    const slug = 'driggs-jackson-eb';
    const id = await routeId(slug);
    await env.DB.prepare(
      `INSERT INTO route_typicals
         (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
       VALUES (?, 'weekday', 9, 'summer', 1800, 1700, 1900, 30, 5)`,
    )
      .bind(id)
      .run();

    const result = await getHistory(env, slug, Date.parse('2026-08-15T18:00:00.000Z'));
    const bucket = result!.typicals.find((t) => t.hour === 9 && t.season === 'summer');
    expect(bucket?.sampleCount).toBe(30);
    expect(bucket?.distinctDays).toBe(5);
  });

  it('reports NULL confidence for pre-0002 rows rather than defaulting to 0', async () => {
    // 0 would read as a real measurement of "no days"; NULL is "unknown",
    // and the client gates on NULL the same way it gates on too-few days.
    const slug = 'driggs-airport-eb';
    const id = await routeId(slug);
    await env.DB.prepare(
      `INSERT INTO route_typicals (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec)
       VALUES (?, 'weekday', 9, 'summer', 1800, 1700, 1900)`,
    )
      .bind(id)
      .run();

    const result = await getHistory(env, slug, Date.parse('2026-08-15T18:00:00.000Z'));
    const bucket = result!.typicals.find((t) => t.hour === 9 && t.season === 'summer');
    expect(bucket?.distinctDays).toBeNull();
  });
});

describe('GET /api/history — summary', () => {
  const NOW = Date.parse('2026-08-15T18:00:00.000Z'); // 12:00 MDT, summer

  it('worstDays: top 3 per-day peaks, descending, grouped by DENVER day', async () => {
    const slug = 'victor-jackson-wb';
    const id = await routeId(slug);
    // Four Denver days with distinct peaks. The 2026-08-12 pair straddles
    // UTC midnight (03:00Z on the 13th is 21:00 MDT on the 12th) -- both
    // must land on 2026-08-12, and its peak must be the larger, 3000.
    await insertTravelTime(id, '2026-08-10T18:00:00.000Z', 1800);
    await insertTravelTime(id, '2026-08-11T18:00:00.000Z', 3600);
    await insertTravelTime(id, '2026-08-12T18:00:00.000Z', 2400);
    await insertTravelTime(id, '2026-08-13T03:00:00.000Z', 3000);
    await insertTravelTime(id, '2026-08-14T18:00:00.000Z', 2000);

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.worstDays).toEqual([
      { date: '2026-08-11', peakSec: 3600 },
      { date: '2026-08-12', peakSec: 3000 },
      { date: '2026-08-14', peakSec: 2000 },
    ]);
  });

  it('worstDays: excludes readings from a previous season', async () => {
    const slug = 'victor-tetonvillage-wb';
    const id = await routeId(slug);
    // Feb 2026 is the previous (winter) season; it must not appear in a
    // summer "this season" list even though it is the slowest reading.
    await insertTravelTime(id, '2026-02-10T19:00:00.000Z', 9999);
    await insertTravelTime(id, '2026-08-11T18:00:00.000Z', 1800);

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.worstDays).toEqual([{ date: '2026-08-11', peakSec: 1800 }]);
  });

  it('worstDays: null when the season has no readings at all', async () => {
    const result = await getHistory(env, 'driggs-jackson-wb', NOW);
    expect(result!.summary.worstDays).toBeNull();
  });

  it('seasonMedians: winter null under summer-only data', async () => {
    const slug = 'victor-airport-eb';
    const id = await routeId(slug);
    for (const [hour, median] of [
      [7, 1800],
      [8, 2400],
      [9, 3000],
    ]) {
      await env.DB.prepare(
        `INSERT INTO route_typicals
           (route_id, weekday_class, hour, season, median_sec, p25_sec, p75_sec, sample_count, distinct_days)
         VALUES (?, 'weekday', ?, 'summer', ?, 1700, 1900, 30, 5)`,
      )
        .bind(id, hour, median)
        .run();
    }

    const result = await getHistory(env, slug, NOW);
    expect(result!.summary.seasonMedians?.summer).toBe(2400);
    expect(result!.summary.seasonMedians?.winter).toBeNull();
  });

  it('closureDays: null when we have no snapshot coverage of a completed winter', async () => {
    // The site started recording in Aug 2026. The most recent completed
    // winter (Nov 2025 - Apr 2026) predates every snapshot we hold, so the
    // honest answer is "unknown" -- NOT 0, which would claim we watched
    // that winter and saw no closures.
    const result = await getHistory(env, 'driggs-airport-wb', NOW);
    expect(result!.summary.closureDays?.winter).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:worker -- api-history`
Expected: FAIL — `summary` is undefined.

- [ ] **Step 3: Move the types to shared**

Cut the `HistoryTypical` / `HistoryToday` / `HistoryResult` interfaces out of `src/worker/api/history.ts`, paste them into `src/shared/types.ts` with the additions shown in **Interfaces** above, and in `history.ts` replace them with:

```ts
import type { HistoryResult, HistorySummary, HistoryTypical } from '../../shared/types';

// Re-exported so existing importers (test/worker/api-history.test.ts,
// api/router.ts) keep resolving these from here after the move to shared/.
export type { HistoryResult, HistorySummary, HistoryTypical } from '../../shared/types';
```

- [ ] **Step 4: Implement the summary**

In `src/worker/api/history.ts`, extend the imports:

```ts
import { db, routes, routeTypicals } from '../db';
import type { Env } from '../env';
import { nearestRank } from '../poller/aggregate';
import { denverDateKey, denverMidnightMs, denverParts, denverSeasonStartMs } from '../tz';
```

Map the two new columns in the existing `typicals` projection:

```ts
  const typicals: HistoryTypical[] = typicalRows.map((r) => ({
    weekdayClass: r.weekdayClass,
    season: r.season,
    hour: r.hour,
    medianSec: r.medianSec,
    p25Sec: r.p25Sec,
    p75Sec: r.p75Sec,
    sampleCount: r.sampleCount,
    distinctDays: r.distinctDays,
  }));
```

Add these helpers above `getHistory`:

```ts
/**
 * Per-Denver-day peak travel time for the current season to date, worst 3
 * first. Grouped in TS rather than SQL for the same reason rebuildTypicals
 * does it: SQLite/D1 has no time-zone functions, so a SQL GROUP BY would
 * group by UTC day and split Denver evenings across two rows.
 *
 * Returns null (not []) when the season has no readings -- the UI renders
 * an empty state for "we have not recorded any of this season yet", which
 * is a different statement from "this season had no slow days".
 */
async function worstDaysThisSeason(
  env: Env,
  routeId: number,
  nowMs: number,
): Promise<{ date: string; peakSec: number }[] | null> {
  const seasonStartIso = new Date(denverSeasonStartMs(nowMs)).toISOString();
  const rows = (
    await env.DB.prepare(
      `SELECT captured_at AS capturedAt, duration_sec AS durationSec
         FROM travel_times WHERE route_id = ? AND captured_at >= ?`,
    )
      .bind(routeId, seasonStartIso)
      .all()
  ).results as unknown as TodayRow[];

  const peaks = new Map<string, number>();
  for (const row of rows) {
    const ms = Date.parse(row.capturedAt);
    if (!Number.isFinite(ms)) continue; // same defensive skip as aggregate.ts
    const key = denverDateKey(ms);
    const prev = peaks.get(key);
    if (prev === undefined || row.durationSec > prev) peaks.set(key, row.durationSec);
  }
  if (peaks.size === 0) return null;

  return [...peaks.entries()]
    .map(([date, peakSec]) => ({ date, peakSec }))
    .sort((a, b) => b.peakSec - a.peakSec)
    .slice(0, 3);
}

/** Median across every hour bucket recorded for `season`, or null if none. */
function seasonMedian(typicals: HistoryTypical[], season: 'winter' | 'summer'): number | null {
  const medians = typicals
    .filter((t) => t.season === season && t.medianSec !== null)
    .map((t) => t.medianSec as number)
    .sort((a, b) => a - b);
  return medians.length === 0 ? null : nearestRank(medians, 50);
}

/**
 * Distinct Denver days with a CLOSED status during the most recent
 * COMPLETED winter (Nov 1 - Apr 30). Returns null when our snapshot history
 * does not reach back to the start of that winter: we cannot distinguish
 * "no closures" from "we were not watching", and reporting 0 would assert
 * the former. The mock's "Closure days last winter: 11" is sample data --
 * this field stays null until we have actually observed a full winter.
 */
async function closureDaysLastWinter(env: Env, nowMs: number): Promise<number | null> {
  const { season } = denverParts(nowMs);
  const currentSeasonStart = denverSeasonStartMs(nowMs);
  // If it is currently winter, "last completed winter" is the one before
  // this one; otherwise it is the winter that ended this spring.
  const probeMs =
    season === 'winter'
      ? currentSeasonStart - 24 * 3_600_000 * 200 // land in the prior winter
      : currentSeasonStart - 24 * 3_600_000; // April 30, the winter just ended
  const winterStart = denverSeasonStartMs(probeMs);
  const winterEnd = denverSeasonStartMs(winterStart + 24 * 3_600_000 * 200); // the following May 1

  const earliest = (await env.DB.prepare(
    'SELECT MIN(captured_at) AS earliest FROM status_snapshots',
  ).first()) as { earliest: string | null } | null;
  if (!earliest?.earliest) return null;
  if (Date.parse(earliest.earliest) > winterStart) return null; // no coverage

  const rows = (
    await env.DB.prepare(
      // Lowercase 'closed' -- schema.ts:66 declares the enum as
      // ['open','restricted','closed','unknown']. The four-state names are
      // uppercase in the API/UI layer but lowercase in the DB column.
      `SELECT captured_at AS capturedAt FROM status_snapshots
        WHERE status = 'closed' AND captured_at >= ? AND captured_at < ?`,
    )
      .bind(new Date(winterStart).toISOString(), new Date(winterEnd).toISOString())
      .all()
  ).results as unknown as { capturedAt: string }[];

  const days = new Set<string>();
  for (const row of rows) {
    const ms = Date.parse(row.capturedAt);
    if (Number.isFinite(ms)) days.add(denverDateKey(ms));
  }
  return days.size;
}
```

Then assemble it in `getHistory`, before the return:

```ts
  const summary: HistorySummary = {
    worstDays: await worstDaysThisSeason(env, route.id, nowMs),
    seasonMedians: {
      summer: seasonMedian(typicals, 'summer'),
      winter: seasonMedian(typicals, 'winter'),
    },
    closureDays: { winter: await closureDaysLastWinter(env, nowMs) },
  };

  return { route: { slug: route.slug, name: route.name }, typicals, today: todayRows, summary };
```

- [ ] **Step 5: Run and verify it passes**

Run: `npm run test:worker -- api-history`
Expected: PASS, including the three pre-existing tests.

- [ ] **Step 6: Run the whole worker suite for regressions**

Run: `npm run test:worker`
Expected: PASS. `getHistory`'s signature already accepted `nowMs`, so no caller changes.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/worker/api/history.ts test/worker/api-history.test.ts
git commit -m "feat(api): add confidence fields and summary to /api/history"
```

---

## Task 6: The TypicalChart component

**Files:**
- Create: `src/app/components/TypicalChart.tsx`
- Test: `test/app/TypicalChart.test.tsx`

**Interfaces:**
- Consumes: `bandRuns`, `MIN_DISTINCT_DAYS_FOR_BAND` (Task 4).
- Produces:

```ts
export interface ChartPoint {
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
  distinctDays: number | null;
}
export interface TypicalChartProps {
  points: ChartPoint[];                              // ascending by hour
  today: { hour: number; durationSec: number }[];    // ascending by hour
  compact?: boolean;
}
export default function TypicalChart(props: TypicalChartProps): JSX.Element;
```

Test hooks: the band polygons carry `data-testid="band"`, the median polyline `data-testid="median"`, today's polyline `data-testid="today"`, the now-dot `data-testid="now-dot"`.

- [ ] **Step 1: Write the failing test**

Create `test/app/TypicalChart.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TypicalChart, { type ChartPoint } from '../../src/app/components/TypicalChart';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';

function pt(hour: number, distinctDays: number | null): ChartPoint {
  return { hour, medianSec: 1800, p25Sec: 1700, p75Sec: 1900, distinctDays };
}

const OK = MIN_DISTINCT_DAYS_FOR_BAND;

describe('TypicalChart', () => {
  it('draws a band where the bucket has enough distinct days', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(screen.getAllByTestId('band')).toHaveLength(1);
  });

  it('withholds the band but still draws the median when data is thin', () => {
    render(<TypicalChart points={[pt(6, 1), pt(7, 1)]} today={[]} />);
    expect(screen.queryAllByTestId('band')).toHaveLength(0);
    expect(screen.getByTestId('median')).toBeTruthy();
  });

  it('emits two polygons when a thin hour interrupts the band', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK), pt(8, 1), pt(9, OK), pt(10, OK)]} today={[]} />);
    expect(screen.getAllByTestId('band')).toHaveLength(2);
  });

  it('annotates the latest reading as the now-dot', () => {
    render(
      <TypicalChart
        points={[pt(6, OK), pt(7, OK), pt(8, OK)]}
        today={[
          { hour: 6, durationSec: 1800 },
          { hour: 7, durationSec: 2280 },
        ]}
      />,
    );
    expect(screen.getByTestId('now-dot')).toBeTruthy();
    expect(screen.getByText(/now · 38m/)).toBeTruthy(); // 2280s = 38 min
  });

  it('renders no today line when there are no readings yet', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(screen.queryByTestId('today')).toBeNull();
    expect(screen.queryByTestId('now-dot')).toBeNull();
  });

  it('uses design tokens, never hardcoded mock hex', () => {
    // The mock is light-mode only (#faf7f0 / #eae4d8); the app ships a dark
    // token set, so any literal hex here would be invisible or wrong in
    // dark mode.
    const { container } = render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(container.innerHTML).not.toMatch(/#faf7f0|#eae4d8|#2b2620/i);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:app -- TypicalChart`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement**

Create `src/app/components/TypicalChart.tsx`:

```tsx
import { bandRuns } from '../../shared/history';

export interface ChartPoint {
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
  distinctDays: number | null;
}

export interface TypicalChartProps {
  points: ChartPoint[];
  today: { hour: number; durationSec: number }[];
  compact?: boolean;
}

const VB_W = 940;
const VB_H = 260;
const PAD = { left: 40, right: 10, top: 20, bottom: 40 };

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

export default function TypicalChart({ points, today, compact = false }: TypicalChartProps) {
  if (points.length === 0) return <p className="text-muted text-sm">No history for this route yet.</p>;

  const hours = points.map((p) => p.hour);
  const hMin = Math.min(...hours);
  const hMax = Math.max(...hours);

  // Y domain spans every value we actually draw -- band edges, medians, and
  // today's readings -- so nothing clips outside the plot area.
  const values = [
    ...points.flatMap((p) => [p.medianSec, p.p25Sec, p.p75Sec]),
    ...today.map((t) => t.durationSec),
  ].filter((v): v is number => v !== null);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const span = vMax - vMin || 1;

  const x = (hour: number) =>
    PAD.left + ((hour - hMin) / (hMax - hMin || 1)) * (VB_W - PAD.left - PAD.right);
  const y = (sec: number) =>
    PAD.top + (1 - (sec - vMin) / span) * (VB_H - PAD.top - PAD.bottom);

  const medianPts = points
    .filter((p) => p.medianSec !== null)
    .map((p) => `${x(p.hour)},${y(p.medianSec as number)}`)
    .join(' ');

  const todayPts = today.map((t) => `${x(t.hour)},${y(t.durationSec)}`).join(' ');
  const last = today[today.length - 1];

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full"
      role="img"
      aria-label="Travel time by hour of day, today against the typical range"
    >
      {/* Band first so the lines paint over it. One polygon per contiguous
          qualifying run -- bandRuns guarantees no polygon spans a thin or
          missing hour. */}
      {bandRuns(points).map((run) => {
        const top = run.map((p) => `${x(p.hour)},${y(p.p75Sec as number)}`);
        const bottom = [...run].reverse().map((p) => `${x(p.hour)},${y(p.p25Sec as number)}`);
        return (
          <polygon
            key={`band-${run[0].hour}`}
            data-testid="band"
            points={[...top, ...bottom].join(' ')}
            fill="var(--color-status-open)"
            fillOpacity="0.16"
          />
        );
      })}

      {medianPts && (
        <polyline
          data-testid="median"
          points={medianPts}
          fill="none"
          stroke="var(--color-status-open)"
          strokeWidth="2"
        />
      )}

      {todayPts && (
        <polyline
          data-testid="today"
          points={todayPts}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}

      {last && (
        <>
          <circle
            data-testid="now-dot"
            cx={x(last.hour)}
            cy={y(last.durationSec)}
            r="5"
            fill="var(--color-accent)"
          />
          {!compact && (
            <text
              x={x(last.hour)}
              y={y(last.durationSec) - 14}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="var(--color-accent)"
            >
              {`now · ${minutes(last.durationSec)}m`}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test:app -- TypicalChart`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/TypicalChart.tsx test/app/TypicalChart.test.tsx
git commit -m "feat(app): add TypicalChart with per-bucket band gating"
```

---

## Task 7: The two summary tables with empty states

**Files:**
- Create: `src/app/components/WorstDays.tsx`, `src/app/components/SeasonCompare.tsx`
- Test: `test/app/HistoryTables.test.tsx`

**Interfaces:**
- Consumes: `HistorySummary` from `src/shared/types.ts` (Task 5).
- Produces:
  - `WorstDays({ worstDays, recordingSince }: { worstDays: HistorySummary['worstDays']; recordingSince: string | null })`
  - `SeasonCompare({ seasonMedians, closureDays }: Pick<HistorySummary, 'seasonMedians' | 'closureDays'>)`

- [ ] **Step 1: Write the failing test**

Create `test/app/HistoryTables.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SeasonCompare from '../../src/app/components/SeasonCompare';
import WorstDays from '../../src/app/components/WorstDays';

describe('WorstDays', () => {
  it('lists each day with its peak', () => {
    render(
      <WorstDays
        worstDays={[
          { date: '2026-08-11', peakSec: 3600 },
          { date: '2026-08-12', peakSec: 3000 },
        ]}
        recordingSince="2026-08-08"
      />,
    );
    expect(screen.getByText('60 min peak')).toBeTruthy(); // 3600s
    expect(screen.getByText('50 min peak')).toBeTruthy(); // 3000s
  });

  it('shows an empty state, mentioning when recording started, when null', () => {
    render(<WorstDays worstDays={null} recordingSince="2026-08-08" />);
    expect(screen.getByText(/not enough history yet/i)).toBeTruthy();
    expect(screen.getByText(/Aug 8/)).toBeTruthy();
  });

  it('renders a short list as-is rather than padding to three', () => {
    render(<WorstDays worstDays={[{ date: '2026-08-11', peakSec: 3600 }]} recordingSince="2026-08-08" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('SeasonCompare', () => {
  it('shows summer and omits winter rows that are null', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: null }} closureDays={{ winter: null }} />,
    );
    expect(screen.getByText(/34 min/)).toBeTruthy(); // 2040s
    expect(screen.getByText(/after the first snow/i)).toBeTruthy();
  });

  it('shows both medians and the closure count once winter data exists', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: 2460 }} closureDays={{ winter: 11 }} />,
    );
    expect(screen.getByText(/34 min/)).toBeTruthy();
    expect(screen.getByText(/41 min/)).toBeTruthy(); // 2460s
    expect(screen.getByText('11')).toBeTruthy();
  });

  it('does not claim zero closures when the count is unknown', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: 2460 }} closureDays={{ winter: null }} />,
    );
    expect(screen.queryByText(/^0$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:app -- HistoryTables`
Expected: FAIL — cannot resolve the components.

- [ ] **Step 3: Implement both components**

Create `src/app/components/WorstDays.tsx`:

```tsx
import type { HistorySummary } from '../../shared/types';

function peakLabel(sec: number): string {
  return `${Math.round(sec / 60)} min peak`;
}

function dayLabel(isoDate: string): string {
  // isoDate is already a Denver-local 'YYYY-MM-DD' key from the API --
  // parse it as UTC noon so no local-timezone shift moves it a day.
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WorstDays({
  worstDays,
  recordingSince,
}: {
  worstDays: HistorySummary['worstDays'];
  recordingSince: string | null;
}) {
  return (
    <div className="bg-card border-card-border rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-bold">Worst days this season</h2>
      {worstDays === null || worstDays.length === 0 ? (
        <p className="text-muted mt-2.5 text-[13px]">
          Not enough history yet
          {recordingSince ? ` — recording since ${dayLabel(recordingSince)}` : ''}.
        </p>
      ) : (
        <ul className="mt-2.5 text-[13px]">
          {worstDays.map((d) => (
            <li
              key={d.date}
              className="border-card-border flex justify-between border-b py-1.5 last:border-b-0"
            >
              <span>{dayLabel(d.date)}</span>
              <strong>{peakLabel(d.peakSec)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Create `src/app/components/SeasonCompare.tsx`:

```tsx
import type { HistorySummary } from '../../shared/types';

function minLabel(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-card-border flex justify-between border-b py-1.5 last:border-b-0">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function SeasonCompare({
  seasonMedians,
  closureDays,
}: Pick<HistorySummary, 'seasonMedians' | 'closureDays'>) {
  const summer = seasonMedians?.summer ?? null;
  const winter = seasonMedians?.winter ?? null;
  const closures = closureDays?.winter ?? null;

  return (
    <div className="bg-card border-card-border rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-bold">Winter vs summer</h2>
      <div className="mt-2.5 text-[13px]">
        {summer !== null && <Row label="Median, summer" value={minLabel(summer)} />}
        {winter !== null && <Row label="Median, winter" value={minLabel(winter)} />}
        {/* Rendered only when known. A 0 here would assert we watched a full
            winter and saw no closures -- see closureDaysLastWinter. */}
        {closures !== null && <Row label="Closure days last winter (WYDOT)" value={String(closures)} />}
        {winter === null && (
          <p className="text-muted">Check back after the first snow — we need a winter to compare to.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test:app -- HistoryTables`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/WorstDays.tsx src/app/components/SeasonCompare.tsx test/app/HistoryTables.test.tsx
git commit -m "feat(app): add worst-days and season-compare cards with empty states"
```

---

## Task 8: The /history page and its vite entry

**Files:**
- Create: `src/app/history.html`, `src/app/history.tsx`, `src/app/HistoryPage.tsx`, `src/app/historyApi.ts`
- Modify: `vite.config.ts:200-204`

**Interfaces:**
- Consumes: `TypicalChart` (Task 6), `WorstDays`/`SeasonCompare` (Task 7), `HistoryResult` (Task 5).
- Produces: `getHistory(slug: string): Promise<HistoryResult>` in `historyApi.ts`; a `/history` page.

- [ ] **Step 1: Add the vite entry**

In `vite.config.ts`, add a 4th input:

```ts
      input: {
        main: path.resolve(dirname, 'index.html'),
        admin: path.resolve(dirname, 'src/app/admin.html'),
        embed: path.resolve(dirname, 'src/app/embed.html'),
        history: path.resolve(dirname, 'src/app/history.html'),
      },
```

- [ ] **Step 2: Write the fetch client**

Create `src/app/historyApi.ts`:

```ts
import type { HistoryResult } from '../shared/types';

const FETCH_TIMEOUT_MS = 15_000;

/** Reads our own /api/history -- clients never call WYDOT or Google
 *  directly (CLAUDE.md). Mirrors api.ts's timeout guard. */
export async function getHistory(slug: string): Promise<HistoryResult> {
  const res = await fetch(`/api/history?route=${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/history failed with ${res.status}`);
  return (await res.json()) as HistoryResult;
}
```

- [ ] **Step 3: Write the page**

Create `src/app/HistoryPage.tsx`. Season and weekday-class are derived from the browser clock via `Intl`, never hardcoded — the mock's "winter Saturday" is wrong today:

```tsx
import { useEffect, useState } from 'react';

import SeasonCompare from './components/SeasonCompare';
import TypicalChart, { type ChartPoint } from './components/TypicalChart';
import WorstDays from './components/WorstDays';
import { getHistory } from './historyApi';
import type { ApiStatus, HistoryResult } from '../shared/types';

/** Denver-local weekday-class + season for the client's current time. Same
 *  Nov-Apr/May-Oct split as the worker's tz.ts denverParts. */
function denverNow(): { weekdayClass: 'weekday' | 'weekend'; season: 'winter' | 'summer'; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'numeric',
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Monday';
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  return {
    weekday,
    weekdayClass: weekday === 'Saturday' || weekday === 'Sunday' ? 'weekend' : 'weekday',
    season: month >= 11 || month <= 4 ? 'winter' : 'summer',
  };
}

function denverHourOf(iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
}

export default function HistoryPage() {
  const [routes, setRoutes] = useState<ApiStatus['travelTimes']>([]);
  const [direction, setDirection] = useState<'eb' | 'wb'>('eb');
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResult | null>(null);

  // Route list comes from /api/status so the tabs mirror DriveTimes exactly
  // -- History and Home never disagree about which routes matter.
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json() as Promise<ApiStatus>)
      .then((s) => setRoutes(s.travelTimes))
      .catch(() => setRoutes([]));
  }, []);

  const visible = routes.filter((r) => r.slug.endsWith(`-${direction}`));
  const active = slug && visible.some((r) => r.slug === slug) ? slug : (visible[0]?.slug ?? null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    getHistory(active)
      .then((h) => !cancelled && setData(h))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const { weekday, weekdayClass, season } = denverNow();

  const points: ChartPoint[] = (data?.typicals ?? [])
    .filter((t) => t.weekdayClass === weekdayClass && t.season === season)
    .sort((a, b) => a.hour - b.hour)
    .map((t) => ({
      hour: t.hour,
      medianSec: t.medianSec,
      p25Sec: t.p25Sec,
      p75Sec: t.p75Sec,
      distinctDays: t.distinctDays,
    }));

  const today = (data?.today ?? []).map((r) => ({
    hour: denverHourOf(r.capturedAt),
    durationSec: r.durationSec,
  }));

  const recordingSince = data?.summary.worstDays?.length
    ? [...data.summary.worstDays].sort((a, b) => a.date.localeCompare(b.date))[0].date
    : null;

  return (
    <main className="bg-page min-h-screen pb-10">
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[1080px] lg:px-7">
        <header className="flex items-center justify-between py-4">
          <div className="flex items-baseline gap-3.5">
            <span className="font-display text-[21px] font-extrabold tracking-tight">Teton Pass Cam</span>
            <span className="text-muted text-xs">History</span>
          </div>
          <a href="/" className="text-muted text-[13px] font-bold">
            ← Back to live conditions
          </a>
        </header>

        <h1 className="font-display text-[30px] font-extrabold tracking-tight">When should you leave?</h1>
        <p className="text-muted mt-1 text-sm">
          {`Travel time by hour of day — today's line against the typical band for a ${season} ${weekday}.`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {visible.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => setSlug(r.slug)}
              className={
                r.slug === active
                  ? 'bg-btn-bg text-btn-ink rounded-full px-4 py-1.5 text-[13px] font-bold'
                  : 'bg-card border-card-border text-muted rounded-full border px-4 py-1.5 text-[13px]'
              }
            >
              {r.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDirection((d) => (d === 'eb' ? 'wb' : 'eb'))}
            className="text-muted ml-auto text-[13px] font-bold"
          >
            Flip
          </button>
        </div>

        <section className="bg-card border-card-border mt-4 rounded-2xl border p-5">
          <div className="text-muted mb-2.5 flex flex-wrap gap-4 text-[11.5px]">
            <span>— Today</span>
            <span>▬ Typical band (p25–p75)</span>
            <span>— Typical median</span>
          </div>
          <TypicalChart points={points} today={today} />
          <p className="text-muted mt-2 text-[11.5px]">
            The band is shown only for hours with enough separate days of history behind them.
          </p>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <WorstDays worstDays={data?.summary.worstDays ?? null} recordingSince={recordingSince} />
          <SeasonCompare
            seasonMedians={data?.summary.seasonMedians ?? null}
            closureDays={data?.summary.closureDays ?? null}
          />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Write the entry point and HTML shell**

Create `src/app/history.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import HistoryPage from './HistoryPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HistoryPage />
  </StrictMode>,
);
```

Create `src/app/history.html`. Copy the `<head>` icon/theme-color block from `index.html` verbatim, with page-specific title/description/canonical:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Teton Pass drive times by hour — history</title>
    <meta
      name="description"
      content="Typical Teton Pass drive times by hour of day, with today's times against the usual range. See when the Victor–Jackson commute is slowest."
    />
    <link rel="canonical" href="https://tetonpasscam.com/history" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#faf7f0" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#211d17" media="(prefers-color-scheme: dark)" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/history.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Build and verify the entry emits**

Run: `npm run build && ls dist/history.html`
Expected: `dist/history.html` exists.

- [ ] **Step 6: Verify /history actually resolves under the worker**

This is the step the spec flags as needing empirical confirmation — `run_worker_first = true` plus `not_found_handling = "404-page"` has surprised this project before (see `wrangler.toml`'s own comments).

Run: `npm run dev` in one shell, then in another:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/history
curl -s http://localhost:8787/history | grep -o '<title>[^<]*</title>'
```

Expected: `200`, and the history title — **not** the homepage title and not a 404.

If it 404s, add an explicit branch in `src/worker/index.ts` before the final `return env.ASSETS.fetch(req)`:

```ts
    if (req.method === 'GET' && url.pathname === '/history') {
      return env.ASSETS.fetch(new Request(new URL('/history.html', url.origin), req));
    }
```

- [ ] **Step 7: Add /history to the service worker denylist**

`vite.config.ts:133` already has a `navigateFallbackDenylist` (added for `/s/*` during share-cards). Without an entry here, an installed-PWA user navigating to `/history` gets `index.html` served from the SW cache instead of the real history document. Add:

```ts
          /^\/history$/,
```

Then confirm `test/app/pwa-config.test.ts` still passes — it asserts on this config:

Run: `npm run test:app -- pwa-config`
Expected: PASS. If it pins the denylist contents exactly, update that assertion to include the new entry.

- [ ] **Step 8: Test that the season/weekday copy derives from the clock**

The mock hardcodes "winter Saturday"; a literal that happens to read correctly in January is the exact regression this guards. Create `test/app/HistoryPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HistoryPage from '../../src/app/HistoryPage';

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).startsWith('/api/status')
          ? { travelTimes: [{ slug: 'victor-jackson-eb', name: 'Victor → Jackson' }] }
          : {
              route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
              typicals: [],
              today: [],
              summary: { worstDays: null, seasonMedians: null, closureDays: null },
            },
    })),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HistoryPage subtitle', () => {
  it('says "summer Saturday" in August', async () => {
    // shouldAdvanceTime is required, not optional: waitFor polls on timers,
    // so plain useFakeTimers() freezes it and the test hangs to timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T18:00:00.000Z')); // Sat, 12:00 MDT
    stubApi();
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/summer Saturday/)).toBeTruthy());
  });

  it('says "winter Wednesday" in January', async () => {
    // shouldAdvanceTime is required, not optional: waitFor polls on timers,
    // so plain useFakeTimers() freezes it and the test hangs to timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-14T19:00:00.000Z')); // Wed, 12:00 MST
    stubApi();
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText(/winter Wednesday/)).toBeTruthy());
  });
});
```

Run: `npm run test:app -- HistoryPage`
Expected: PASS both.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts src/app/history.html src/app/history.tsx src/app/HistoryPage.tsx src/app/historyApi.ts test/app/HistoryPage.test.tsx
git commit -m "feat(app): add the /history page as a fourth vite entry"
```

---

## Task 9: Compact chart card on the home page

**Files:**
- Create: `src/app/components/HomeHistoryCard.tsx`
- Modify: `src/app/App.tsx:93-113`
- Test: `test/app/HomeHistoryCard.test.tsx` (new file — `App.test.tsx` already exists and covers the page shell; keep this card's tests separate)

**Interfaces:**
- Consumes: `TypicalChart` with `compact` (Task 6), `getHistory` (Task 8).
- Produces: a card in the home column linking to `/history`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HomeHistoryCard from '../../src/app/components/HomeHistoryCard';

describe('HomeHistoryCard', () => {
  it('links to the full history page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
          typicals: [],
          today: [],
          summary: { worstDays: null, seasonMedians: null, closureDays: null },
        }),
      })),
    );
    render(<HomeHistoryCard slug="victor-jackson-eb" />);
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/history'));
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm run test:app -- HomeHistoryCard`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement**

Create `src/app/components/HomeHistoryCard.tsx`:

```tsx
import { useEffect, useState } from 'react';

import TypicalChart, { type ChartPoint } from './TypicalChart';
import { getHistory } from '../historyApi';

export default function HomeHistoryCard({ slug }: { slug: string }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [today, setToday] = useState<{ hour: number; durationSec: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    getHistory(slug)
      .then((h) => {
        if (cancelled) return;
        const hourOf = (iso: string) =>
          Number(
            new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Denver',
              hour: 'numeric',
              hourCycle: 'h23',
            }).format(new Date(iso)),
          );
        setPoints(
          [...h.typicals]
            .sort((a, b) => a.hour - b.hour)
            .map((t) => ({
              hour: t.hour,
              medianSec: t.medianSec,
              p25Sec: t.p25Sec,
              p75Sec: t.p75Sec,
              distinctDays: t.distinctDays,
            })),
        );
        setToday(h.today.map((r) => ({ hour: hourOf(r.capturedAt), durationSec: r.durationSec })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <a href="/history" className="bg-card border-card-border block rounded-2xl border p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[15px] font-bold">When should you leave?</h2>
        <span className="text-muted text-[13px]">See full history →</span>
      </div>
      <div className="mt-2">
        <TypicalChart points={points} today={today} compact />
      </div>
    </a>
  );
}
```

Then wire it into `src/app/App.tsx`, inside the existing `flex flex-col gap-2` stack after the `DriveTimes` block. Pass the first route matching the current direction so the card follows the flip toggle. Render nothing when there is no such route — `travelTimes` omits routes with no readings, and an empty slug would fetch `/api/history?route=` and take a 400:

```tsx
          {(() => {
            const historySlug = data.travelTimes.find((t) => t.slug.endsWith(`-${direction}`))?.slug;
            return historySlug ? (
              <div>
                <HomeHistoryCard slug={historySlug} />
              </div>
            ) : null;
          })()}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm run test:app`
Expected: PASS, all app tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/HomeHistoryCard.tsx src/app/App.tsx test/app/
git commit -m "feat(app): add compact history card linking to /history from home"
```

---

## Task 10: Full verification

- [ ] **Step 1: All three suites**

```bash
npm run test && npm run test:worker && npm run test:app
```
Expected: all PASS. Do not proceed past a failure.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean, with `dist/history.html` emitted.

- [ ] **Step 3: Launch checks against a local dev worker**

Run `npm run dev`, then: `scripts/verify-launch.sh http://localhost:8787 --skip-writes`
Expected: PASS — confirms the new vite entry did not disturb the homepage SEO shell or `/api/*` routing.

- [ ] **Step 4: Confirm the band gate end-to-end**

With `wrangler dev` running against local D1, seed a route with one bucket at 5 distinct days and a neighbouring bucket at 1, run the nightly job, then load `/history` and confirm visually that the band breaks at the thin hour while the median line continues.

```bash
npx wrangler d1 execute tetonpasscam --local --command \
  "SELECT hour, sample_count, distinct_days FROM route_typicals ORDER BY hour LIMIT 24"
```

- [ ] **Step 5: Capacitor check (P1 DoD)**

Run: `npx cap sync`
Expected: clean — the new entry is a static file, so this should be unaffected, but it is a DoD item.

- [ ] **Step 6: Commit any fixes and report**

Report to Drew: whether `/history` resolved without a worker change (Task 8 Step 6), and the real `distinct_days` distribution from Step 4 — the spec flags `MIN_DISTINCT_DAYS_FOR_BAND = 4` as reasoned rather than measured, and this is the first chance to check it against actual data.

---

## Deferred to a follow-up

- Running the bucket-count query against **production** D1 (`wrangler` was not authorized during design; `code: 7403`) and re-tuning the threshold.
- Revisiting "Winter vs summer" in December when `winter` first goes non-null, and `closureDays` in spring 2027 when a full winter has been observed.
- Reason annotations on worst days ("storm + crash") — cut deliberately; would need an `alerts`/`status_snapshots` join and risks inventing content.
