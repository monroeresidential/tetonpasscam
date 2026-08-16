# Hourly Forecast Row + Brand Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rolling next-12-hours forecast row above the 5-day strip, replace the NWS photographic icons with emoji on the site's existing icon tile, and delete the now-unused icon proxy.

**Architecture:** The poller already fetches 156 hourly NWS periods and discards everything the daily rollup doesn't use. It gains a second write from the same payload — the first 48 periods into a new `forecast_hours` table, keyed on parsed epoch milliseconds — in the same `db.batch()` as the daily upserts. `/api/status` gains `hourly`, loses `forecast[].iconPath`. Both strips render a glyph on the `bg-icon-tile` treatment `AlertsStrip` already uses.

**Tech Stack:** Cloudflare Workers, Hono, D1 + drizzle-orm, React 19 + Vite, Tailwind, vitest (three configs: parsers/node, worker/`@cloudflare/vitest-pool-workers`, app/jsdom).

**Spec:** `docs/superpowers/specs/2026-08-16-hourly-forecast-and-icons-design.md`

## Global Constraints

- **The forecast never influences the OPEN / RESTRICTED / CLOSED banner.** Not `status`, `isStale`, `pollerDead`, or `lastConfirmed`. The byte-identical regression test in `test/worker/api-status.test.ts` must keep passing and must be extended to strip `hourly` too.
- **No invented reopening estimates, no predicted road conditions.** No copy may imply when a closed pass reopens; no hour may be labelled with a road state.
- **Absence is `null` / `[]`, never `0` or a placeholder.** A null `precipPct` renders `—`. An empty array renders nothing at all — no empty framed section.
- **Instants are compared as integers, never as ISO-with-offset strings.** `forecast_hours` is keyed on `start_ms`; `start_time` is display-only and must never appear in a `WHERE` or `ORDER BY`.
- **Temperatures are stored and transported in Fahrenheit only**; `formatTemp(f, unit)` derives °C at render.
- **`hourly` is a new REQUIRED field on `ApiStatus`.** A returning user's cached `localStorage['last-status']` will not contain it. Guard with `hourly?.length` from the first commit — this exact hazard produced a Critical last cycle.
- **Migrations 0000–0009 are frozen** (0009 is applied to remote D1). Add a new `0010_*.sql` via `npm run db:generate`; never edit an existing one.
- The window is a rolling **next 12 hours** headed "Next 12 hours" — not today's calendar hours.
- Glyphs use **emoji presentation** with explicit U+FE0F where the base character defaults to text (`☀️`, `☁️`, `❄️`), so a twelve-card row is uniformly colour rather than mixed.
- This repo **typechecks nowhere** (`build` is `vite build`, esbuild only; no eslint config). A green suite is not evidence of type correctness.

---

## File Structure

| File | Change |
| --- | --- |
| `src/worker/poller/nws-forecast.ts` | **modify** — add `HourlyReading`, `STORED_HOURS`, `takeHours()`; write hours in the existing batch |
| `src/worker/db/schema.ts` | **modify** — add `forecastHours` |
| `migrations/0010_*.sql` | **new** — generated |
| `src/shared/types.ts` | **modify** — add `ForecastHour`, `ApiStatus.hourly`; remove `ForecastDay.iconPath` |
| `src/worker/api/status.ts` | **modify** — read `hourly`; stop mapping `iconPath` |
| `src/app/weatherGlyphs.ts` | **new** — category→glyph map, beside `alertTypes.ts` |
| `src/app/components/ForecastStrip.tsx` | **modify** — glyph tile replaces `<img>` |
| `src/app/components/HourlyStrip.tsx` | **new** — the 12-hour scroller |
| `src/app/App.tsx` | **modify** — mount `HourlyStrip` above `ForecastStrip` |
| `src/worker/api/wx-icon.ts` | **delete** |
| `src/worker/api/router.ts` | **modify** — unmount `/wx-icon/*` |
| `test/worker/api-wx-icon.test.ts` | **delete** |

`takeHours` lives in `nws-forecast.ts` beside `rollupDaily` because both derive from the same fetched payload and change together; the module lands around 420 lines, in line with `wydot-status.ts` (519).

---

## Task 1: `forecast_hours` table + `takeHours()`

**Files:**
- Modify: `src/worker/db/schema.ts`
- Modify: `src/worker/poller/nws-forecast.ts`
- Create: `migrations/0010_*.sql` (generated)
- Test: `test/parsers/nws-forecast.test.ts` (append), `test/worker/forecast.test.ts` (append)

**Interfaces:**
- Consumes: `HourlyPeriod`, `categorize()`, `toF()` — all already in `nws-forecast.ts`
- Produces: `forecastHours` drizzle table; `interface HourlyReading`; `const STORED_HOURS = 48`; `takeHours(periods: HourlyPeriod[], limit?: number): HourlyReading[]`

- [ ] **Step 1: Write the failing tests**

Append to `test/parsers/nws-forecast.test.ts` (it already imports `live` and the `period`/`hours` helpers):

```ts
import { takeHours, STORED_HOURS } from '../../src/worker/poller/nws-forecast';

describe('takeHours', () => {
  it('caps at STORED_HOURS and preserves upstream order', () => {
    const out = takeHours(live);
    expect(out).toHaveLength(STORED_HOURS);
    expect(out[0].startTime).toBe(live[0].startTime);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThan(out[i - 1].startMs);
    }
  });

  it('parses startMs as a true instant, not a string sort key', () => {
    // The fall-back night: 01:30-06:00 is 07:30Z, EARLIER than 01:00-07:00
    // (08:00Z), even though it sorts after it as a string. startMs must
    // reflect the instant.
    const out = takeHours([
      period({ startTime: '2026-11-01T01:30:00-06:00' }),
      period({ startTime: '2026-11-01T01:00:00-07:00' }),
    ]);
    expect(out[0].startMs).toBe(Date.parse('2026-11-01T01:30:00-06:00'));
    expect(out[1].startMs).toBe(Date.parse('2026-11-01T01:00:00-07:00'));
    expect(out[0].startMs).toBeLessThan(out[1].startMs);
  });

  it('carries isDaytime through per period', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', isDaytime: true }),
      period({ startTime: '2026-08-16T22:00:00-06:00', isDaytime: false }),
    ]);
    expect(out[0].isDaytime).toBe(true);
    expect(out[1].isDaytime).toBe(false);
  });

  it('reuses categorize, so an hour agrees with the daily rollup vocabulary', () => {
    const out = takeHours([period({ startTime: '2026-08-16T14:00:00-06:00', shortForecast: 'Chance Snow Showers' })]);
    expect(out[0].category).toBe('snow');
  });

  it('keeps a null precip as null, never 0', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', probabilityOfPrecipitation: { value: null } }),
    ]);
    expect(out[0].precipPct).toBeNull();
  });

  it('normalizes a Celsius period to Fahrenheit', () => {
    const out = takeHours([
      period({ startTime: '2026-08-16T14:00:00-06:00', temperature: 0, temperatureUnit: 'C' }),
    ]);
    expect(out[0].tempF).toBe(32);
  });

  it('drops a period whose startTime will not parse', () => {
    const out = takeHours([
      period({ startTime: 'not-a-time' }),
      period({ startTime: '2026-08-16T14:00:00-06:00' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].startTime).toBe('2026-08-16T14:00:00-06:00');
  });

  it('returns an empty array for no periods', () => {
    expect(takeHours([])).toEqual([]);
  });
});
```

Append to `test/worker/forecast.test.ts`:

```ts
describe('forecast_hours table', () => {
  it('stores and reads back an hour, keyed on start_ms', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    await env.DB.prepare(
      `INSERT INTO forecast_hours
         (start_ms, start_time, temp_f, category, is_daytime, icon_url, short_forecast, precip_pct, fetched_at)
       VALUES (?, '2026-08-16T14:00:00-06:00', 66, 'thunderstorm', 1, 'https://x/tsra', 'Storms', 34, '2026-08-16T18:00:00.000Z')`,
    )
      .bind(Date.parse('2026-08-16T14:00:00-06:00'))
      .run();

    const row = (await env.DB.prepare('SELECT * FROM forecast_hours').first()) as any;
    expect(row.start_ms).toBe(Date.parse('2026-08-16T14:00:00-06:00'));
    expect(row.category).toBe('thunderstorm');
    expect(row.is_daytime).toBe(1);
  });

  it('allows every reading column to be null', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    await env.DB.prepare(
      `INSERT INTO forecast_hours (start_ms, start_time, category, is_daytime, fetched_at)
       VALUES (1, '2026-08-16T14:00:00-06:00', 'cloudy', 0, '2026-08-16T18:00:00.000Z')`,
    ).run();
    const row = (await env.DB.prepare('SELECT temp_f, precip_pct FROM forecast_hours').first()) as any;
    expect(row.temp_f).toBeNull();
    expect(row.precip_pct).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npm run test -- nws-forecast
npm run test:worker -- forecast
```
Expected: parser suite FAILS with `takeHours is not a function`; worker suite FAILS with `no such table: forecast_hours`.

- [ ] **Step 3: Add the table to the schema**

In `src/worker/db/schema.ts`, after `forecastDays`:

```ts
/**
 * Hourly NWS periods backing the near-term forecast row. Fully REPLACED on
 * each refresh rather than upserted: unlike `forecast_days`, whose rows are a
 * stable set of dates worth revising in place, these are a sliding window
 * where yesterday's 3 PM is simply gone. Replace-all keeps the table from
 * growing a tail nobody reads and removes any need for a prune job.
 */
export const forecastHours = sqliteTable('forecast_hours', {
  // Epoch milliseconds, parsed at write. The primary key, and the ONLY column
  // ever compared or ordered on. The ISO string below cannot be used for
  // either: across a DST change it sorts wrongly -- 01:30-06:00 (07:30Z) is
  // earlier than 01:00-07:00 (08:00Z) but sorts after it. An integer instant
  // cannot be ambiguous that way.
  startMs: integer('start_ms').primaryKey(),
  // The original ISO-with-offset string, for display and debugging only.
  startTime: text('start_time').notNull(),
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

Register it in the `schema` export object after `forecastDays`:

```ts
  forecastHours,
```

- [ ] **Step 4: Implement `takeHours`**

In `src/worker/poller/nws-forecast.ts`, after `rollupDaily`:

```ts
/**
 * How many upstream periods are persisted. Twelve are rendered; 48 gives
 * roughly two days, so the row survives a poller outage of ~36 hours before
 * it starts thinning, while keeping the replace-all batch at 49 statements
 * rather than 157.
 */
export const STORED_HOURS = 48;

export interface HourlyReading {
  startMs: number;
  startTime: string;
  tempF: number | null;
  category: ForecastCategory;
  isDaytime: boolean;
  iconUrl: string | null;
  shortForecast: string | null;
  precipPct: number | null;
}

/**
 * Normalize the first `limit` upstream periods for storage, in upstream
 * order. Deliberately NOT a rollup -- these are stored as sent, and all the
 * windowing happens at read time, so a single stored set serves whatever
 * window the UI asks for later.
 *
 * A period whose `startTime` will not parse is dropped rather than stored
 * with a NaN key: `start_ms` is the primary key and the sort column, so a
 * NaN there would poison ordering for the whole table.
 */
export function takeHours(periods: HourlyPeriod[], limit: number = STORED_HOURS): HourlyReading[] {
  const out: HourlyReading[] = [];
  for (const p of periods) {
    if (out.length >= limit) break;
    const startMs = Date.parse(p.startTime);
    if (!Number.isFinite(startMs)) continue;
    const tempF = toF(p.temperature, p.temperatureUnit);
    out.push({
      startMs,
      startTime: p.startTime,
      tempF: Number.isFinite(tempF) ? Math.round(tempF) : null,
      category: categorize(p.shortForecast),
      isDaytime: p.isDaytime,
      iconUrl: p.icon,
      shortForecast: p.shortForecast,
      precipPct: p.probabilityOfPrecipitation?.value ?? null,
    });
  }
  return out;
}
```

- [ ] **Step 5: Generate and apply the migration**

```bash
npm run db:generate
git status --short migrations/
```

Expected: exactly one new `0010_*.sql` plus `migrations/meta/` updates. If any `000[0-9]_*.sql` other than the new one shows as modified, STOP and report BLOCKED.

```bash
npm run db:migrate:local
```

- [ ] **Step 6: Run the tests**

```
npm run test -- nws-forecast
npm run test:worker -- forecast
```
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker/db/schema.ts src/worker/poller/nws-forecast.ts migrations/ test/parsers/nws-forecast.test.ts test/worker/forecast.test.ts
git commit -m "feat(forecast): forecast_hours table + takeHours (migration 0010)

Keyed on parsed epoch ms, not the ISO-with-offset string: that string
sorts wrongly across a DST change, where 01:30-06:00 precedes
01:00-07:00 chronologically but follows it lexicographically."
```

---

## Task 2: Poller writes hours in the same batch

**Files:**
- Modify: `src/worker/poller/nws-forecast.ts` (`runForecastStep`)
- Test: `test/worker/forecast.test.ts` (append)

**Interfaces:**
- Consumes: `takeHours`, `forecastHours` (Task 1)
- Produces: no new exports — `runForecastStep`'s signature is unchanged

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/forecast.test.ts`:

```ts
describe('runForecastStep hourly write', () => {
  it('writes hours and days from the same fetch, in one batch', async () => {
    await clearForecast();
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const fetcher = fakeNws();

    await runForecastStep(env as any, fetcher, Date.parse('2026-08-16T16:00:00.000Z'));

    const hours = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_hours').first();
    expect((hours as any).n).toBe(48);

    // Same fetch ⇒ same fetched_at in both tables. The two are rendered
    // adjacent, so a reader would notice them disagreeing.
    const dayStamp = (await env.DB.prepare('SELECT fetched_at AS f FROM forecast_days LIMIT 1').first()) as any;
    const hourStamp = (await env.DB.prepare('SELECT fetched_at AS f FROM forecast_hours LIMIT 1').first()) as any;
    expect(hourStamp.f).toBe(dayStamp.f);
  });

  it('replaces hours wholesale rather than accumulating', async () => {
    await clearForecast();
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    // A stale row from a previous window that no longer appears upstream.
    await env.DB.prepare(
      `INSERT INTO forecast_hours (start_ms, start_time, category, is_daytime, fetched_at)
       VALUES (1, '2020-01-01T00:00:00-07:00', 'cloudy', 0, '2020-01-01T00:00:00.000Z')`,
    ).run();

    await runForecastStep(env as any, fakeNws(), Date.parse('2026-08-16T16:00:00.000Z'));

    const stale = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_hours WHERE start_ms = 1').first();
    expect((stale as any).n).toBe(0);
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_hours').first();
    expect((total as any).n).toBe(48);
  });

  it('leaves BOTH tables untouched when the batch fails', async () => {
    await clearForecast();
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const batchSpy = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(
      runForecastStep(env as any, fakeNws(), Date.parse('2026-08-16T16:00:00.000Z')),
    ).rejects.toThrow('boom');
    batchSpy.mockRestore();

    expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_days').first()) as any).n).toBe(0);
    expect(((await env.DB.prepare('SELECT COUNT(*) AS n FROM forecast_hours').first()) as any).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:worker -- forecast`
Expected: FAIL — `forecast_hours` count is 0 after a cycle.

- [ ] **Step 3: Extend the batch**

In `runForecastStep`, after `const days = rollupDaily(periods);` add:

```ts
  const hours = takeHours(periods);
```

Then, after the existing `const statements = days.map(...)` array is built, append the hourly statements to the same batch before it is executed:

```ts
  // The hourly window is REPLACED, not upserted -- see the forecastHours
  // schema comment. The delete and the inserts join the day upserts in ONE
  // batch (D1 runs a batch as a single transaction) so the two tables can
  // never disagree about which fetch they came from. They render adjacent to
  // each other, and a today-card contradicting the hour beneath it is the
  // kind of inconsistency a reader notices immediately.
  const allStatements = [
    ...statements,
    database.delete(forecastHours),
    ...hours.map((h) =>
      database.insert(forecastHours).values({
        startMs: h.startMs,
        startTime: h.startTime,
        tempF: h.tempF,
        category: h.category,
        isDaytime: h.isDaytime,
        iconUrl: h.iconUrl,
        shortForecast: h.shortForecast,
        precipPct: h.precipPct,
        fetchedAt,
      }),
    ),
  ];

  await database.batch(
    allStatements as [(typeof allStatements)[number], ...(typeof allStatements)[number][]],
  );
```

Replace the existing `await database.batch(statements as ...)` call with the above. Add `forecastHours` to the existing `from '../db'` import.

Note the ordering inside the array is load-bearing: the `delete` must precede the hourly inserts, and D1 executes a batch's statements in order.

- [ ] **Step 4: Run the tests**

```
npm run test:worker -- forecast poller
```
Expected: PASS, including the pre-existing poller suite.

- [ ] **Step 5: Commit**

```bash
git add src/worker/poller/nws-forecast.ts test/worker/forecast.test.ts
git commit -m "feat(forecast): store 48 hourly periods in the daily batch

One transaction for both tables, so they can never disagree about which
fetch produced them -- they render adjacent and a mismatch is visible."
```

---

## Task 3: `/api/status` gains `hourly`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/worker/api/status.ts`
- Test: `test/worker/api-status.test.ts` (append + amend)

**Interfaces:**
- Consumes: `forecast_hours` (Task 1)
- Produces: `interface ForecastHour`; `ApiStatus.hourly: ForecastHour[]`; `const HOURLY_HOURS = 12` from `status.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/worker/api-status.test.ts`:

```ts
describe('hourly', () => {
  async function insertHour(o: { startTime: string; tempF?: number; isDaytime?: boolean; precipPct?: number | null }) {
    await env.DB.prepare(
      `INSERT INTO forecast_hours
         (start_ms, start_time, temp_f, category, is_daytime, icon_url, short_forecast, precip_pct, fetched_at)
       VALUES (?, ?, ?, 'clear', ?, NULL, 'Sunny', ?, '2026-08-16T18:00:00.000Z')`,
    )
      .bind(
        Date.parse(o.startTime),
        o.startTime,
        o.tempF ?? 60,
        o.isDaytime === false ? 0 : 1,
        o.precipPct === undefined ? 10 : o.precipPct,
      )
      .run();
  }

  it('returns at most 12 upcoming hours, oldest first, none in the past', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const now = Date.parse('2026-08-16T18:00:00.000Z');
    setTestNowMs(now);
    for (let i = -3; i < 20; i++) {
      await insertHour({ startTime: new Date(now + i * 3_600_000).toISOString() });
    }

    const { body } = await getStatus();
    expect(body.hourly).toHaveLength(12);
    expect(Date.parse(body.hourly[0].startTime)).toBeGreaterThanOrEqual(now);
    for (let i = 1; i < body.hourly.length; i++) {
      expect(Date.parse(body.hourly[i].startTime)).toBeGreaterThan(Date.parse(body.hourly[i - 1].startTime));
    }
    setTestNowMs(undefined);
  });

  it('orders correctly across a DST fall-back, where the ISO strings sort wrongly', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const now = Date.parse('2026-11-01T06:00:00.000Z');
    setTestNowMs(now);
    // 01:30-06:00 is 07:30Z; 01:00-07:00 is 08:00Z. Chronologically the
    // former comes first, lexicographically the latter does.
    await insertHour({ startTime: '2026-11-01T01:00:00-07:00' });
    await insertHour({ startTime: '2026-11-01T01:30:00-06:00' });

    const { body } = await getStatus();
    expect(body.hourly.map((h) => h.startTime)).toEqual([
      '2026-11-01T01:30:00-06:00',
      '2026-11-01T01:00:00-07:00',
    ]);
    setTestNowMs(undefined);
  });

  it('exposes isDaytime as a boolean, not SQLite 0/1', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const now = Date.parse('2026-08-16T18:00:00.000Z');
    setTestNowMs(now);
    await insertHour({ startTime: new Date(now + 3_600_000).toISOString(), isDaytime: false });
    const { body } = await getStatus();
    expect(body.hourly[0].isDaytime).toBe(false);
    setTestNowMs(undefined);
  });

  it('keeps a null precip as null', async () => {
    await env.DB.prepare('DELETE FROM forecast_hours').run();
    const now = Date.parse('2026-08-16T18:00:00.000Z');
    setTestNowMs(now);
    await insertHour({ startTime: new Date(now + 3_600_000).toISOString(), precipPct: null });
    const { body } = await getStatus();
    expect(body.hourly[0].precipPct).toBeNull();
    setTestNowMs(undefined);
  });

  it('degrades to [] when the hourly read fails, leaving the rest intact', async () => {
    const now = Date.parse('2026-08-16T18:00:00.000Z');
    setTestNowMs(now);
    const original = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('forecast_hours')) throw new Error('no such table');
      return original(sql);
    });

    const { res, body } = await getStatus();
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(body.hourly).toEqual([]);
    expect(body.status).toBeDefined();
    expect(body.conditionText).toBeDefined();
    setTestNowMs(undefined);
  });
});
```

Also amend the existing `HARD RULE: no forecast leaves every other field identical` test's `strip` helper to drop `hourly` alongside the other two:

```ts
    const strip = (b: ApiStatus) => {
      const { forecast, forecastStale, hourly, ...rest } = b;
      return rest;
    };
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:worker -- api-status`
Expected: FAIL — `body.hourly` is undefined.

- [ ] **Step 3: Add the type**

In `src/shared/types.ts`, after `ForecastDay`:

```ts
/** One upcoming hour of the summit forecast, as embedded in
 *  `ApiStatus.hourly`. Absence is `null`, never `0`. */
export interface ForecastHour {
  // The original ISO-with-offset string from NWS. Display only -- ordering
  // and filtering happen on the stored epoch key, never on this string,
  // which sorts wrongly across a DST change.
  startTime: string;
  tempF: number | null;
  category: ForecastCategory;
  // NWS's own daylight flag for this period, so a clear 10 PM hour can show
  // a moon rather than a sun.
  isDaytime: boolean;
  shortForecast: string | null;
  precipPct: number | null;
}
```

Add to `ApiStatus`, after `forecastStale`:

```ts
  // The next 12 hours from api.weather.gov, oldest first. Empty when
  // unavailable. Governed by `forecastStale` above -- one upstream, one
  // freshness signal.
  //
  // HARD RULE: like `forecast`, this NEVER influences `status`.
  hourly: ForecastHour[];
```

- [ ] **Step 4: Read the rows**

In `src/worker/api/status.ts`, add `ForecastHour` to the existing `shared/types` type import, and a constant beside `FORECAST_DAYS`:

```ts
/** Hours the near-term strip renders. */
export const HOURLY_HOURS = 12;
```

Add this block immediately after the existing forecast try/catch, before `const alerts = await getActiveAlerts(env, nowMs);`:

```ts
  // Hourly. Its own try/catch for the same reason as the daily block: a
  // forecast failure must never fail the one endpoint the home screen needs.
  let hourly: ForecastHour[] = [];
  try {
    const hourRows = (
      await env.DB.prepare(
        `SELECT start_time AS startTime, temp_f AS tempF, category,
                is_daytime AS isDaytime, short_forecast AS shortForecast,
                precip_pct AS precipPct
           FROM forecast_hours
          WHERE start_ms >= ?
          ORDER BY start_ms
          LIMIT ?`,
      )
        .bind(nowMs, HOURLY_HOURS)
        .all()
    ).results as unknown as {
      startTime: string;
      tempF: number | null;
      category: string;
      isDaytime: number;
      shortForecast: string | null;
      precipPct: number | null;
    }[];

    hourly = hourRows.map((row) => ({
      startTime: row.startTime,
      tempF: row.tempF,
      category: row.category as ForecastHour['category'],
      // SQLite has no boolean type; the column stores 0/1.
      isDaytime: row.isDaytime === 1,
      shortForecast: row.shortForecast,
      precipPct: row.precipPct,
    }));
  } catch (err) {
    console.error('[status] hourly read failed', err);
    hourly = [];
  }
```

Add `hourly,` to the returned object after `forecastStale,`.

- [ ] **Step 5: Run the tests**

Run: `npm run test:worker -- api-status`
Expected: PASS, including the amended hard-rule test.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/worker/api/status.ts test/worker/api-status.test.ts
git commit -m "feat(forecast): expose the next 12 hours on /api/status

Filtered and ordered on the integer epoch key, so the fall-back night
returns hours in chronological order rather than string order."
```

---

## Task 4: Glyph module + `ForecastStrip` uses it

**Files:**
- Create: `src/app/weatherGlyphs.ts`
- Modify: `src/app/components/ForecastStrip.tsx`
- Test: `test/app/ForecastStrip.test.tsx` (amend)

**Interfaces:**
- Consumes: `ForecastCategory` from `src/shared/types.ts`
- Produces: `WEATHER_GLYPH`, `WEATHER_GLYPH_NIGHT`, `glyphFor(category, isDaytime)`

- [ ] **Step 1: Write the failing tests**

Create `test/app/weatherGlyphs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { WEATHER_GLYPH, WEATHER_GLYPH_NIGHT, glyphFor } from '../../src/app/weatherGlyphs';
import type { ForecastCategory } from '../../src/shared/types';

const ALL: ForecastCategory[] = [
  'clear', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'mixed', 'thunderstorm', 'fog',
];

describe('weatherGlyphs', () => {
  it('covers every category', () => {
    for (const c of ALL) expect(WEATHER_GLYPH[c]).toBeTruthy();
  });

  it('swaps to a night glyph only where a sun would be wrong', () => {
    expect(glyphFor('clear', false)).not.toBe(glyphFor('clear', true));
    expect(glyphFor('partly-cloudy', false)).not.toBe(glyphFor('partly-cloudy', true));
    // Precipitation and cloud look the same after dark.
    expect(glyphFor('snow', false)).toBe(glyphFor('snow', true));
    expect(glyphFor('rain', false)).toBe(glyphFor('rain', true));
  });

  it('gives every glyph emoji presentation, and no gratuitous selectors', () => {
    // Verified empirically with \p{Emoji_Presentation}: of our eight base
    // characters, ONLY U+26C5 (partly-cloudy) is emoji-by-default. The other
    // seven default to monochrome text and need U+FE0F, or the row renders
    // half flat-ink and half colour. U+26C5 must NOT carry one -- a selector
    // on an already-emoji character is noise that invites someone to
    // "consistently" add them everywhere and mask a real omission.
    for (const c of ALL) {
      const g = WEATHER_GLYPH[c];
      const base = String.fromCodePoint(g.codePointAt(0)!);
      const isEmojiByDefault = /\p{Emoji_Presentation}/u.test(base);
      const hasSelector = g.includes('️');
      expect(hasSelector, `${c} (${base})`).toBe(!isEmojiByDefault);
    }
  });

  it('applies the same rule to the night variants', () => {
    for (const g of Object.values(WEATHER_GLYPH_NIGHT)) {
      const base = String.fromCodePoint(g!.codePointAt(0)!);
      expect(g!.includes('️')).toBe(!/\p{Emoji_Presentation}/u.test(base));
    }
  });
});
```

Amend `test/app/ForecastStrip.test.tsx`: remove the two tests that assert on images (`describes each icon with the forecast text`, `drops an icon that fails to load…`) and the `iconPath` field from its `day()` helper, then add:

```ts
  it('renders a glyph tile per card rather than a remote image', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('glyph-tile')).toHaveLength(5);
  });

  it('uses the day glyph for daily cards regardless of the hour', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    const tiles = screen.getAllByTestId('glyph-tile');
    expect(tiles[1]).toHaveTextContent(WEATHER_GLYPH.snow);
  });
```

(importing `WEATHER_GLYPH` from `../../src/app/weatherGlyphs`).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- weatherGlyphs ForecastStrip`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the glyph module**

Create `src/app/weatherGlyphs.ts`:

```ts
import type { ForecastCategory } from '../shared/types';

/**
 * Category-to-glyph metadata for both forecast strips, hoisted here rather
 * than exported from either component -- the same reasoning as
 * `alertTypes.ts`, whose structure this mirrors: neither strip owns weather
 * metadata, and the two must not drift.
 *
 * Every glyph uses EMOJI presentation, with an explicit U+FE0F on the
 * characters that would otherwise default to monochrome text (U+2600 sun,
 * U+2601 cloud, U+2744 snowflake). A row of twelve mixing flat-ink and
 * full-colour glyphs looks broken in a way neither style does alone. Note
 * this differs from `alertTypes.ts`'s bare `❄`/`⚠` -- those render one at a
 * time, so the inconsistency never shows.
 */
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

/**
 * Night variants for the only two categories where a daytime glyph is
 * actively wrong. A clear 10 PM hour showing a sun is the sort of small
 * wrongness that makes a whole strip feel untrustworthy; rain and snow look
 * the same after dark.
 */
export const WEATHER_GLYPH_NIGHT: Partial<Record<ForecastCategory, string>> = {
  clear: '🌙',
  'partly-cloudy': '☁️',
};

export function glyphFor(category: ForecastCategory, isDaytime: boolean): string {
  if (!isDaytime) {
    const night = WEATHER_GLYPH_NIGHT[category];
    if (night) return night;
  }
  return WEATHER_GLYPH[category];
}
```

- [ ] **Step 4: Swap the image for a glyph tile in `ForecastStrip`**

In `src/app/components/ForecastStrip.tsx`:

- Delete the `useState` import, the `brokenIcons` state, the `ICON_PX` constant, and the whole `<img>` block with its `onError`.
- Add `import { glyphFor } from '../weatherGlyphs';`
- Replace the image element with:

```tsx
            <div
              aria-hidden="true"
              data-testid="glyph-tile"
              className="bg-icon-tile flex h-10 w-10 items-center justify-center rounded-[10px] text-[20px]"
            >
              {/* Daily cards always take the day glyph: a whole-day summary
                  is not an hour, so a moon would be as wrong at noon as a
                  sun is at midnight. */}
              {glyphFor(d.category, true)}
            </div>
```

The tile is `aria-hidden` because `shortForecast` already carries the same information to a screen reader in the card's text; announcing an emoji name alongside it is noise.

- [ ] **Step 5: Run the tests**

Run: `npm run test:app`
Expected: PASS. `ForecastStrip` no longer references `iconPath`.

- [ ] **Step 6: Commit**

```bash
git add src/app/weatherGlyphs.ts src/app/components/ForecastStrip.tsx test/app/weatherGlyphs.test.ts test/app/ForecastStrip.test.tsx
git commit -m "feat(forecast): glyph tiles instead of NWS artwork

Uses the bg-icon-tile treatment AlertsStrip already ships, so the
forecast reads as part of the same system rather than imported."
```

---

## Task 5: `HourlyStrip` component

**Files:**
- Create: `src/app/components/HourlyStrip.tsx`
- Modify: `src/app/App.tsx`
- Test: `test/app/HourlyStrip.test.tsx`, `test/app/App.test.tsx` (amend)

**Interfaces:**
- Consumes: `ForecastHour` (Task 3), `glyphFor` (Task 4), `formatTemp`/`TempUnit`

- [ ] **Step 1: Write the failing tests**

Create `test/app/HourlyStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HourlyStrip from '../../src/app/components/HourlyStrip';
import { WEATHER_GLYPH, WEATHER_GLYPH_NIGHT } from '../../src/app/weatherGlyphs';
import type { ForecastHour } from '../../src/shared/types';

function hour(over: Partial<ForecastHour> & { startTime: string }): ForecastHour {
  return {
    tempF: 62,
    category: 'clear',
    isDaytime: true,
    shortForecast: 'Sunny',
    precipPct: 20,
    ...over,
  };
}

const TWELVE: ForecastHour[] = Array.from({ length: 12 }, (_, i) =>
  hour({ startTime: `2026-08-16T${String(13 + i).padStart(2, '0')}:00:00-06:00` }),
);

describe('HourlyStrip', () => {
  it('renders a card per hour under the rolling heading', () => {
    render(<HourlyStrip hourly={TWELVE} />);
    expect(screen.getByRole('heading', { name: 'Next 12 hours' })).toBeInTheDocument();
    expect(screen.getAllByTestId('hour-card')).toHaveLength(12);
  });

  it('labels hours in America/Denver regardless of the viewer', () => {
    render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} />);
    expect(screen.getByText('1 PM')).toBeInTheDocument();
  });

  it('renders temperatures in the selected unit', () => {
    const { rerender } = render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} unit="F" />);
    expect(screen.getByText('62°F')).toBeInTheDocument();
    rerender(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} unit="C" />);
    expect(screen.getByText('17°C')).toBeInTheDocument();
  });

  it('uses the night glyph after dark', () => {
    render(
      <HourlyStrip
        hourly={[hour({ startTime: '2026-08-16T22:00:00-06:00', isDaytime: false, category: 'clear' })]}
      />,
    );
    expect(screen.getByTestId('glyph-tile')).toHaveTextContent(WEATHER_GLYPH_NIGHT.clear!);
    expect(screen.getByTestId('glyph-tile')).not.toHaveTextContent(WEATHER_GLYPH.clear);
  });

  it('shows an em-dash for a null precip, never 0%', () => {
    render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00', precipPct: null })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders nothing at all when empty', () => {
    const { container } = render(<HourlyStrip hourly={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the prop is missing entirely (pre-schema cached payload)', () => {
    const { container } = render(<HourlyStrip hourly={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Amend `test/app/App.test.tsx`: add `hourly: []` to the `makeStatus()` fixture, and extend the existing pre-schema cached-payload test so it deletes **both** keys:

```ts
      JSON.stringify(makeStatus({ forecast: undefined as any, hourly: undefined as any })),
```
with its assertion updated to `expect(JSON.parse(raw)).not.toHaveProperty('hourly')` alongside the existing `forecast` check.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:app -- HourlyStrip`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/app/components/HourlyStrip.tsx`:

```tsx
import type { ForecastHour } from '../../shared/types';
import { formatTemp, type TempUnit } from '../units';
import { glyphFor } from '../weatherGlyphs';

/** Hour-of-day in America/Denver, so every viewer sees pass-local time
 *  rather than their own. `1 PM`, not `13:00` -- this sits beside `54°F`
 *  and `5.6 mph`, all of which are US-conventional. */
const HOUR_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  hour12: true,
});

export default function HourlyStrip({
  hourly,
  unit = 'F',
}: {
  // Declared non-optional on `ApiStatus`, but a payload rehydrated from
  // `localStorage['last-status']` (see useStatus.ts) is only as fresh as the
  // bundle that wrote it, and one written before this field existed has no
  // `hourly` key at all. Guarded here rather than at the call site so every
  // future consumer inherits the protection -- the same hazard that blanked
  // the home screen when `forecast` was added.
  hourly: ForecastHour[] | undefined;
  unit?: TempUnit;
}) {
  if (!hourly?.length) return null;

  return (
    <section aria-labelledby="hourly-heading" className="mt-4">
      <h2 id="hourly-heading" className="font-display text-[15px] font-bold">
        Next 12 hours
      </h2>
      {/* Scrolls rather than shrinks: twelve cards across a 360px phone is
          30px each, which is unreadable. `overflow-x-auto` keeps the scroll
          inside this container so the page itself never scrolls sideways. */}
      <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
        {hourly.map((h) => (
          <div
            key={h.startTime}
            data-testid="hour-card"
            className="bg-card border-card-border rounded-card flex w-[62px] flex-none flex-col items-center gap-1 border px-1 py-2 text-center"
          >
            <p className="text-muted text-[10.5px] uppercase">
              {HOUR_FORMAT.format(new Date(h.startTime))}
            </p>
            <div
              aria-hidden="true"
              data-testid="glyph-tile"
              className="bg-icon-tile flex h-8 w-8 items-center justify-center rounded-[10px] text-[16px]"
            >
              {glyphFor(h.category, h.isDaytime)}
            </div>
            <p className="font-display text-[13px] font-extrabold">
              {h.tempF !== null ? formatTemp(h.tempF, unit) : '—'}
            </p>
            <p className="text-muted text-[10.5px]">
              {h.precipPct !== null ? `${h.precipPct}%` : '—'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount it in App**

In `src/app/App.tsx`, add `import HourlyStrip from './components/HourlyStrip';` beside the other component imports, then render it immediately **before** `<ForecastStrip …/>` (near-term above longer-term):

```tsx
            <HourlyStrip hourly={data.hourly} unit={unit} />
```

- [ ] **Step 5: Run all three suites**

```
npm run test && npm run test:app && npm run test:worker
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/HourlyStrip.tsx src/app/App.tsx test/app/HourlyStrip.test.tsx test/app/App.test.tsx
git commit -m "feat(forecast): next-12-hours strip above the 5-day cards

Guards a missing prop from the first commit: hourly is a new required
ApiStatus field, and a cached payload predating it would otherwise crash
the home screen on mount."
```

---

## Task 6: Delete the icon proxy

**Files:**
- Delete: `src/worker/api/wx-icon.ts`, `test/worker/api-wx-icon.test.ts`
- Modify: `src/worker/api/router.ts`, `src/shared/types.ts`, `src/worker/api/status.ts`, `test/parsers/nws-forecast.test.ts`
- Test: `test/worker/api-status.test.ts` (amend)

**Interfaces:**
- Removes: `toIconPath`, `getWxIcon`, `setTestIconFetcher`, the `/wx-icon/*` route, and `ForecastDay.iconPath`

- [ ] **Step 1: Write the failing test**

Append to `test/worker/api-status.test.ts`:

```ts
it('no longer serves the icon proxy or exposes iconPath', async () => {
  const res = await api.request('/wx-icon/land/day/few', {}, env as any);
  expect(res.status).toBe(404);

  const { body } = await getStatus();
  expect(JSON.stringify(body.forecast)).not.toContain('iconPath');
  expect(JSON.stringify(body)).not.toContain('api.weather.gov');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:worker -- api-status`
Expected: FAIL — the route still answers, and `iconPath` is still present.

- [ ] **Step 3: Remove it**

- `git rm src/worker/api/wx-icon.ts test/worker/api-wx-icon.test.ts`
- In `src/worker/api/router.ts`: delete the `getWxIcon` import and the whole `api.get('/wx-icon/*', …)` block.
- In `src/shared/types.ts`: delete the `iconPath` field and its comment from `ForecastDay`.
- In `src/worker/api/status.ts`: delete the `toIconPath` import, the `iconPath: toIconPath(row.iconUrl),` line from the forecast map, and `icon_url AS iconUrl,` from that query's column list (nothing reads it now).
- In `test/parsers/nws-forecast.test.ts`: delete the `toIconPath` import and the test asserting every fixture icon survives it.
- In `test/worker/api-status.test.ts`: delete the existing `rewrites the NWS icon URL to our proxy path…` test.

Leave the `icon_url` columns in both tables. They hold captured upstream data, cost nothing, and are the raw material if artwork is ever wanted back — dropping a column needs another migration for no benefit.

- [ ] **Step 4: Run everything**

```
npm run test && npm run test:app && npm run test:worker
```
Expected: all green, with the `api-wx-icon` suite gone from the worker run's file count.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(forecast): remove the icon proxy

It existed only to serve NWS artwork to the 5-day strip. With glyphs
local, an unused public endpoint that makes outbound fetches on a
client-supplied path is attack surface with no user. The icon_url
columns stay -- captured data, and raw material if artwork returns."
```

---

## Required manual verification (not a task — for whoever runs this plan)

**Render the page and look at it before calling this done.** Two specific things the suites cannot see:

1. **Glyph consistency.** Confirm the row does not mix flat monochrome and full-colour glyphs. If any do, adjust the variation selectors in `weatherGlyphs.ts` until the set reads as one family.
2. **The scroll container.** Confirm the twelve-card row scrolls within itself and the *page* never scrolls horizontally, at both phone and desktop widths.

The last change to this component shipped a five-card row with one card's contents 40px out of line, with all 283 tests passing. Layout and typographic defects here are invisible to the suite by construction.

Note from `docs`: `wrangler dev` serves a stale `index.html` after a rebuild — if the page renders only the static SEO shell, stop the server, `rm -rf .wrangler/state/v3/cache .wrangler/tmp` (**not** the whole `.wrangler`, which holds the seeded local D1), and restart.

## Deploy note

1. Apply migration 0010 to remote D1 **before** deploying the Worker that reads `forecast_hours`.
2. The deploy removes `/api/wx-icon/*`. A page still holding the previous bundle will request icon paths that now 404; those are `<img>` requests whose `onError` already hides them, so they degrade to a card without a picture and self-correct on reload.
3. `hourly` is a new required `ApiStatus` field — the Task 5 guard is what keeps returning users off a blank page.
