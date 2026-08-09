# tetonpasscam.com P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the P1 web app: Cloudflare Worker (Hono API + cron poller + D1) serving a React/Vite/Tailwind PWA at tetonpasscam.com.

**Architecture:** One Worker project. `fetch` serves static assets + `/api/*`; `scheduled` runs the WYDOT/Google/Idaho poller and nightly aggregation. D1 via Drizzle. Spec: `docs/superpowers/specs/2026-08-09-tetonpasscam-design.md`; product spec: `TETONPASSCAM-SPEC.md`.

**Tech Stack:** TypeScript, Hono, Drizzle ORM + drizzle-kit, D1, React 18, Vite, Tailwind, vite-plugin-pwa, Vitest (+ @cloudflare/vitest-pool-workers for worker tests), Resend API.

## Global Constraints

- Status is `open|restricted|closed|unknown` — **never** a boolean; every failure path resolves to `unknown`, never `open`.
- WYDOT rows located **by text match** on `Between Wilson and the Idaho State Line` — never by cell index.
- Community alerts NEVER affect official status.
- Never touch `map.wyoroad.info/wti511map-data/*.pbf`.
- CLOSED copy verbatim: `Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).` No invented reopening estimates.
- WYDOT fetches: `User-Agent: tetonpasscam.com poller (drew@monroeresidential.com)`, 30s timeout (`AbortSignal.timeout(30_000)`), max 1 retry on 5xx.
- Secrets (`GOOGLE_ROUTES_KEY`, `IDAHO_511_KEY`, `RESEND_KEY`, `ADMIN_TOKEN`) only via `wrangler secret` / `.dev.vars`; never in code or client bundle.
- Timestamps in DB: ISO-8601 UTC strings.
- All money copy/URLs (sponsor UTM link, attribution strings) copied exactly from the design doc.
- Commit after every task; conventional-commit style messages ending with the Claude co-author trailer.

## File Structure (locked)

```
src/shared/types.ts            # PassStatus, StatusResult, WeatherReading, ApiStatus, Alert types
src/worker/index.ts            # export default { fetch, scheduled }
src/worker/env.ts              # Env interface (DB, ASSETS, secrets, vars)
src/worker/api/router.ts       # Hono app assembly
src/worker/api/status.ts       # GET /api/status
src/worker/api/history.ts      # GET /api/history
src/worker/api/alerts.ts       # GET+POST /api/alerts, camera-error beacon
src/worker/api/feedback.ts     # POST /api/feedback
src/worker/api/admin.ts        # /api/admin/* (bearer)
src/worker/poller/wydot-status.ts    # parseRoadClosures, parseRoutesResults, parseStatewide, diffAdvisories
src/worker/poller/wydot-weather.ts   # parseSensorPage
src/worker/poller/google-routes.ts   # fetchRouteTime
src/worker/poller/idaho511.ts        # fetchId33Events
src/worker/poller/run.ts             # runPollCycle (orchestration), fetchDetours
src/worker/poller/aggregate.ts       # nightly typicals rebuild + retention pruning
src/worker/notify.ts           # sendEmail via Resend
src/worker/db/schema.ts        # Drizzle schema (all tables)
src/worker/db/seed-routes.ts   # ROUTES constant (12 directions) + seed SQL
src/app/…                      # React app (App.tsx, components/, api.ts, useStatus.ts)
migrations/…                   # drizzle-kit output
test/fixtures/…                # captured + synthetic WYDOT HTML
test/parsers/*.test.ts         # plain vitest
test/worker/*.test.ts          # vitest-pool-workers (real D1 binding)
wrangler.toml, vite.config.ts, vitest.config.ts, vitest.workers.config.ts, drizzle.config.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `wrangler.toml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.workers.config.ts`, `drizzle.config.ts`, `tailwind.config.js`, `postcss.config.js`, `.gitignore`, `.dev.vars.example`, `index.html`, `src/app/main.tsx`, `src/app/App.tsx`, `src/app/index.css`, `src/worker/index.ts`, `src/worker/env.ts`, `src/worker/api/router.ts`, `src/shared/types.ts`

**Interfaces:**
- Produces: `Env` (`{ DB: D1Database; ASSETS: Fetcher; GOOGLE_ROUTES_KEY: string; IDAHO_511_KEY: string; RESEND_KEY: string; ADMIN_TOKEN: string; ADMIN_EMAIL: string }`); Hono app mounted at `/api`; `PassStatus = 'open'|'restricted'|'closed'|'unknown'`.
- Produces commands: `npm run dev` (wrangler dev with built assets), `npm test` (parser tests), `npm run test:worker`, `npm run build`, `npm run deploy`, `npm run db:generate`, `npm run db:migrate:local`.

- [ ] **Step 1: Init packages**

```bash
npm create vite@latest . -- --template react-ts
npm i hono drizzle-orm
npm i -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers drizzle-kit vitest tailwindcss @tailwindcss/vite vite-plugin-pwa
```

(If `npm create vite` balks at the non-empty dir, scaffold in a temp dir and copy in, keeping our existing docs/ and *.md.)

- [ ] **Step 2: wrangler.toml**

```toml
name = "tetonpasscam"
main = "src/worker/index.ts"
compatibility_date = "2026-08-01"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "tetonpasscam"
database_id = "PLACEHOLDER-set-after-wrangler-d1-create"

[triggers]
crons = ["*/10 11-6 * * *", "0 7-10 * * *", "10 9 * * *"]

[vars]
ADMIN_EMAIL = "drew@monroeresidential.com"
```

Note: `*/10 11-6 * * *` = every 10 min, 11:00 UTC–06:59 UTC (05:00–23:59 MDT window widened per design); `0 7-10` = hourly overnight; `10 9 * * *` = nightly aggregate (dispatcher in Task 8 routes by `event.cron`). The aggregate cron overlaps the 10-min pattern — dispatcher matches exact cron string, so no conflict.

- [ ] **Step 3: Worker entry + router skeleton**

`src/worker/env.ts`:
```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_ROUTES_KEY: string;
  IDAHO_511_KEY: string;
  RESEND_KEY: string;
  ADMIN_TOKEN: string;
  ADMIN_EMAIL: string;
}
```

`src/worker/api/router.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../env';

export const api = new Hono<{ Bindings: Env }>();
api.get('/health', (c) => c.json({ ok: true }));
```

`src/worker/index.ts`:
```ts
import { api } from './api/router';
import type { Env } from './env';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return api.fetch(new Request(new URL(url.pathname.slice(4) + url.search, url.origin), req), env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // dispatcher filled in Task 8
  },
} satisfies ExportedHandler<Env>;
```

`src/shared/types.ts`:
```ts
export type PassStatus = 'open' | 'restricted' | 'closed' | 'unknown';
```

- [ ] **Step 4: Configs** — `vite.config.ts` with react, tailwind, and (later task) PWA plugins, `build.outDir: 'dist'`; `vitest.config.ts` with `include: ['test/parsers/**/*.test.ts']`; `vitest.workers.config.ts` using `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config` with `include: ['test/worker/**/*.test.ts']` and `wrangler: { configPath: './wrangler.toml' }`. package.json scripts:

```json
"dev": "npm run build && wrangler dev",
"build": "vite build",
"test": "vitest run --config vitest.config.ts",
"test:worker": "vitest run --config vitest.workers.config.ts",
"db:generate": "drizzle-kit generate",
"db:migrate:local": "wrangler d1 migrations apply tetonpasscam --local",
"deploy": "npm run build && wrangler deploy"
```

`.gitignore`: `node_modules/ dist/ .wrangler/ .dev.vars`. `.dev.vars.example` lists the four secrets with dummy values.

- [ ] **Step 5: Verify** — `npm run build` succeeds; `npx wrangler dev` (local) then `curl localhost:8787/api/health` → `{"ok":true}`; `curl localhost:8787/` returns the Vite index.html.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: scaffold worker + vite app on cloudflare"`

---

### Task 2: D1 schema, migration, route seeds

**Files:**
- Create: `src/worker/db/schema.ts`, `src/worker/db/seed-routes.ts`, `drizzle.config.ts`, `migrations/*` (generated), `test/worker/db.test.ts`

**Interfaces:**
- Produces: Drizzle tables `routes, travelTimes, routeTypicals, statusSnapshots, weatherSnapshots, id33Events, detourSnapshots, alerts, feedback, bans` exactly matching the design-doc schema; `ROUTES: SeedRoute[]` (12 entries, slugs like `victor-jackson-eb`, `victor-jackson-wb`, …); helper `db(env) => drizzle(env.DB, { schema })`.

- [ ] **Step 1: Write schema** — `src/worker/db/schema.ts` with Drizzle `sqliteTable` defs. Columns per design doc §Database schema, e.g.:

```ts
export const statusSnapshots = sqliteTable('status_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  capturedAt: text('captured_at').notNull(),
  segment: text('segment').notNull().default('wilson-stateline'),
  status: text('status', { enum: ['open', 'restricted', 'closed', 'unknown'] }).notNull(),
  conditionText: text('condition_text'),
  advisories: text('advisories'),      // JSON array string
  restrictions: text('restrictions'),  // JSON array string
  wydotReportTime: text('wydot_report_time'),
  source: text('source'),
});
```

All ten tables in the same style; `routes` has `slug` UNIQUE; `alerts.status` enum `active|expired|removed`; indexes: `travel_times(route_id, captured_at)`, `status_snapshots(captured_at)`, `alerts(expires_at, status)`.

- [ ] **Step 2: Seed constant** — `src/worker/db/seed-routes.ts` exporting the 12 route-directions using design-doc coordinates (Victor 43.6026,-111.1113; Driggs 43.7231,-111.1110; Jackson 43.4799,-110.7624; Teton Village 43.5873,-110.8276; Airport 43.6034,-110.7363) and `seedRoutes(d1)` that INSERT OR IGNOREs them.

- [ ] **Step 3: Generate + apply migration** — `npm run db:generate && npm run db:migrate:local`.

- [ ] **Step 4: Failing→passing test** — `test/worker/db.test.ts` (pool-workers gives a real local D1; call `seedRoutes` in beforeAll):

```ts
import { env } from 'cloudflare:test';
it('seeds exactly 12 route directions with unique slugs', async () => {
  await seedRoutes(env.DB);
  const { results } = await env.DB.prepare('SELECT slug FROM routes').all();
  expect(results.length).toBe(12);
  expect(new Set(results.map((r: any) => r.slug)).size).toBe(12);
});
```

Note: pool-workers applies `migrations/` when configured with `d1Migrations` in `vitest.workers.config.ts` — wire that here.

- [ ] **Step 5: Run** — `npm run test:worker` → PASS.
- [ ] **Step 6: Commit** — `"feat: d1 schema, migrations, 12 seeded route directions"`

---

### Task 3: WYDOT fixtures + RoadClosures parser (the safety-critical one)

**Files:**
- Create: `test/fixtures/roadclosures-open.html` (live capture), `test/fixtures/roadclosures-closed.html`, `test/fixtures/roadclosures-restricted.html`, `test/fixtures/roadclosures-mangled.html` (synthetic edits of the capture), `src/worker/poller/wydot-status.ts`, `test/parsers/roadclosures.test.ts`

**Interfaces:**
- Produces:
```ts
export interface StatusResult {
  status: PassStatus;
  conditionText: string | null;   // raw Closure Reason / Conditions text
  advisories: string[];           // e.g. ['Falling Rock']
  restrictions: string[];         // e.g. ['Chain Law Level 1']
  wydotReportTime: string | null; // ISO UTC, converted from America/Denver
  source: 'primary' | 'fallback' | 'crosscheck';
}
export function parseRoadClosures(html: string): StatusResult;  // never throws; failure ⇒ status 'unknown'
export const SEGMENT_TEXT = 'Between Wilson and the Idaho State Line';
```

- [ ] **Step 1: Capture live fixture**

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  https://www.wyoroad.info/highway/conditions/RoadClosures.html > test/fixtures/roadclosures-open.html
```

Inspect it; confirm the segment row text and note the real column layout in a comment atop the test file. Then create the three synthetic variants by editing copies: `-closed` (Closure Reason → `Road Closed due to winter conditions`), `-restricted` (→ `Road Open` but Other Restrictions cell → `Chain Law Level 1`), `-mangled` (delete the segment row entirely).

- [ ] **Step 2: Write failing tests**

```ts
const load = (f: string) => readFileSync(`test/fixtures/${f}`, 'utf8');

it('parses open',      () => expect(parseRoadClosures(load('roadclosures-open.html')).status).toBe('open'));
it('parses closed',    () => expect(parseRoadClosures(load('roadclosures-closed.html')).status).toBe('closed'));
it('parses restricted', () => {
  const r = parseRoadClosures(load('roadclosures-restricted.html'));
  expect(r.status).toBe('restricted');
  expect(r.restrictions).toContain('Chain Law Level 1');
});
it('missing row ⇒ unknown, never open', () =>
  expect(parseRoadClosures(load('roadclosures-mangled.html')).status).toBe('unknown'));
it('empty/garbage ⇒ unknown', () => {
  expect(parseRoadClosures('').status).toBe('unknown');
  expect(parseRoadClosures('<html><body>oops</body></html>').status).toBe('unknown');
});
it('valley segment (Between Jackson and Wilson) is NOT matched', () => {
  // fixture contains both segments; assert conditionText comes from the Wilson–Stateline row
  const r = parseRoadClosures(load('roadclosures-open.html'));
  expect(r.conditionText).not.toMatch(/Jackson and Wilson/i);
});
it('converts Last Report Time from America/Denver to UTC ISO', () => {
  const r = parseRoadClosures(load('roadclosures-open.html'));
  expect(r.wydotReportTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});
```

- [ ] **Step 3: Run** — `npm test` → all FAIL (module missing).

- [ ] **Step 4: Implement** — no DOM in Workers: parse with regex over `<tr>` blocks. Approach: split html on `<tr`, find the block containing `SEGMENT_TEXT`, strip tags per `<td>`, then classify:

```ts
const CLOSURE_RX = /closed|closure/i;
const RESTRICTION_RX = /chain law|no unnecessary travel|no (light )?trailers|high profile/i;

export function parseRoadClosures(html: string): StatusResult {
  const unknown: StatusResult = { status: 'unknown', conditionText: null, advisories: [], restrictions: [], wydotReportTime: null, source: 'primary' };
  try {
    const row = html.split(/<tr[\s>]/i).find((b) => b.includes(SEGMENT_TEXT));
    if (!row) return unknown;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
    const reason = cells.find((c) => /^road open$/i.test(c)) ?? cells.find((c) => CLOSURE_RX.test(c));
    const restrictions = cells.filter((c) => RESTRICTION_RX.test(c));
    const advisories = cells.filter((c) => /falling rock|blow.?over|black ice/i.test(c) && !RESTRICTION_RX.test(c));
    let status: PassStatus = 'unknown';
    if (reason && /^road open$/i.test(reason)) status = restrictions.length ? 'restricted' : 'open';
    else if (reason && CLOSURE_RX.test(reason)) status = 'closed';
    return { status, conditionText: reason ?? null, advisories, restrictions, wydotReportTime: extractReportTime(row), source: 'primary' };
  } catch { return unknown; }
}
```

`extractReportTime` finds the date-like cell, parses as America/Denver → UTC ISO (implement DST-aware offset with `Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',timeZoneName:'shortOffset'})`; no date libraries). **Adjust cell classification to the real captured layout in Step 1 — the regexes above are the shape, the fixture is the truth.** Never index cells positionally.

- [ ] **Step 5: Run** — `npm test` → PASS.
- [ ] **Step 6: Commit** — `"feat: RoadClosures parser with unknown-biased state machine"`

---

### Task 4: Fallback + cross-check parsers, advisory diff

**Files:**
- Create: `test/fixtures/routesresults-wy22.html`, `test/fixtures/statewide.html` (live captures + a synthetic closed variant of each), `test/parsers/fallback.test.ts`
- Modify: `src/worker/poller/wydot-status.ts`

**Interfaces:**
- Produces:
```ts
export function parseRoutesResults(html: string): StatusResult & { district3Comments: string | null }; // source:'fallback'
export function parseStatewide(html: string): PassStatus;   // which condition heading the segment sits under; 'unknown' if absent
export function diffAdvisories(prev: string[], curr: string[]): { added: string[]; removed: string[] };
```

- [ ] **Step 1: Capture fixtures**

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  "https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22" > test/fixtures/routesresults-wy22.html
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  "https://www.wyoroad.info/pls/Browse/MEDIA.Statewide" > test/fixtures/statewide.html
```

- [ ] **Step 2: Failing tests** — `parseRoutesResults` open fixture → `open` + non-null `district3Comments` when a WY22 comment exists; synthetic `CLOSED` conditions cell → `closed`; garbage → `unknown`. `parseStatewide` returns the heading-derived status for the Wilson–Stateline segment; segment absent → `unknown`. `diffAdvisories(['Falling Rock'], ['Falling Rock'])` → both empty (standing advisory is NOT an event); `diffAdvisories([], ['Falling Rock'])` → added.

- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement** — same `<tr>`-split + text-match technique; `parseStatewide` walks heading blocks (e.g. `<h3>Closed</h3>` … segment list) and reports which heading contains `SEGMENT_TEXT`-equivalent text (the Statewide page words segments slightly differently — match on `Wilson` + `State Line`, confirm exact wording from the fixture). District 3 comments: find the comments block, extract paragraphs mentioning `WY 22|WY22|Teton Pass`.
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `"feat: fallback/cross-check parsers + advisory diffing"`

---

### Task 5: Weather sensor parser

**Files:**
- Create: `test/fixtures/sensors-tetonpass.html` (live capture), `src/worker/poller/wydot-weather.ts`, `test/parsers/weather.test.ts`

**Interfaces:**
- Produces:
```ts
export interface WeatherReading {
  airF: number | null; surfaceF: number | null;
  windAvgMph: number | null; windGustMph: number | null; windDir: string | null;
  visibilityFt: number | null; reportedAt: string | null; // ISO UTC
}
export function parseSensorPage(html: string): WeatherReading | null; // null only if page unrecognizable
```

- [ ] **Step 1: Capture** — `curl -s -A "…" "https://www.wyoroad.info/pls/Browse/Sensors.StationResults?SelectedStation=Teton+Pass" > test/fixtures/sensors-tetonpass.html`
- [ ] **Step 2: Failing tests** — live fixture parses with numeric `airF` and `surfaceF`; individual missing sensor values come back `null` without failing the whole reading (synthetic variant with a blanked cell); garbage html → `null`.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** — label-based extraction (`Air Temperature`, `Surface Temperature`, `Average Wind`, `Wind Gust`, `Visibility` — confirm labels from fixture), numbers via `/-?\d+(\.\d+)?/`. **Step 5:** PASS. **Step 6: Commit** — `"feat: RWIS weather parser"`

---

### Task 6: Google Routes client

**Files:**
- Create: `src/worker/poller/google-routes.ts`, `test/parsers/google-routes.test.ts`

**Interfaces:**
- Consumes: `SeedRoute` from `src/worker/db/seed-routes.ts`.
- Produces:
```ts
export interface RouteTimeResult { durationSec: number; staticDurationSec: number; distanceM: number; }
export function fetchRouteTime(apiKey: string, route: SeedRoute, fetcher?: typeof fetch): Promise<RouteTimeResult | null>; // null on any failure
export function inPollingWindow(nowUtcMs: number): boolean; // 05:00–23:00 America/Denver
```

- [ ] **Step 1: Failing tests** — inject a stub `fetcher`:

```ts
it('maps computeRoutes response', async () => {
  const stub = async () => new Response(JSON.stringify({ routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }] }));
  expect(await fetchRouteTime('k', ROUTES[0], stub)).toEqual({ durationSec: 1860, staticDurationSec: 1800, distanceM: 38000 });
});
it('returns null on 4xx/5xx/timeout/malformed', async () => {
  expect(await fetchRouteTime('k', ROUTES[0], async () => new Response('nope', { status: 500 }))).toBeNull();
  expect(await fetchRouteTime('k', ROUTES[0], async () => { throw new Error('timeout'); })).toBeNull();
});
it('polling window is Denver-local', () => {
  expect(inPollingWindow(Date.UTC(2026, 0, 15, 10, 0))).toBe(false); // 03:00 MST
  expect(inPollingWindow(Date.UTC(2026, 0, 15, 15, 0))).toBe(true);  // 08:00 MST
  expect(inPollingWindow(Date.UTC(2026, 6, 15, 6, 0))).toBe(false);  // 00:00 MDT
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — POST `https://routes.googleapis.com/directions/v2:computeRoutes` with headers `X-Goog-Api-Key`, `X-Goog-FieldMask: routes.duration,routes.staticDuration,routes.distanceMeters`; body `{ origin/destination: { location: { latLng } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE'`; parse `'1860s'` → 1860. `inPollingWindow` via `Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' })`, true for hour ≥ 5 && < 23. **Step 4:** PASS. **Step 5: Commit** — `"feat: google routes client with polling window"`

---

### Task 7: Idaho 511 client

**Files:**
- Create: `src/worker/poller/idaho511.ts`, `test/parsers/idaho511.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Id33Event { eventId: string; description: string; isFullClosure: boolean; }
export function fetchId33Events(apiKey: string, fetcher?: typeof fetch): Promise<Id33Event[] | null>; // null = fetch failed (≠ empty)
```

- [ ] **Step 1: Failing tests** — stub fetcher returning a sample Idaho 511 v2 payload (array of `{ ID, RoadwayName, Description, IsFullClosure, Latitude, Longitude }`): filters to `RoadwayName` containing `33` AND within ~25 mi of Victor (lat 43.2–44.0, lng −111.6–−110.9 box); non-33 and far-away events excluded; HTTP 500 → `null`; empty array → `[]`.
- [ ] **Step 2:** FAIL. **Step 3: Implement** — GET `https://511.idaho.gov/api/v2/get/event?key=${apiKey}&format=json`, one call, filter, map. **Step 4:** PASS. **Step 5: Commit** — `"feat: idaho 511 ID-33 event client"`

---

### Task 8: Poller orchestration (`scheduled`)

**Files:**
- Create: `src/worker/poller/run.ts`, `test/worker/poller.test.ts`
- Modify: `src/worker/index.ts` (dispatcher), `src/worker/api/router.ts` (nothing yet — just ensure exports stable)

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces:
```ts
export function runPollCycle(env: Env, fetcher?: typeof fetch): Promise<void>;
export function resolveStatus(fetcher: typeof fetch): Promise<StatusResult>; // primary → fallback → crosscheck per spec
export function fetchDetours(fetcher: typeof fetch): Promise<{ route: 'US26'|'US89'; conditionText: string }[]>;
```
- Dispatcher: `scheduled` routes `event.cron === '10 9 * * *'` → `runNightly(env)` (Task 12 fills in; stub logs until then), else → `runPollCycle(env)`.

- [ ] **Step 1: Failing tests** (pool-workers, stub fetcher keyed by URL substring):

```ts
function fakeFetch(map: Record<string, string | number>) {
  return async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    const hit = Object.entries(map).find(([k]) => u.includes(k));
    if (!hit) return new Response('not stubbed', { status: 500 });
    return typeof hit[1] === 'number' ? new Response('err', { status: hit[1] }) : new Response(hit[1]);
  };
}

it('happy path writes status+weather rows, one per cycle', async () => {
  await runPollCycle(env as any, fakeFetch({
    'RoadClosures.html': load('roadclosures-open.html'),
    'Sensors.StationResults': load('sensors-tetonpass.html'),
    'routes.googleapis.com': JSON.stringify({ routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }] }),
    '511.idaho.gov': '[]',
  }));
  const s = await env.DB.prepare('SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1').first();
  expect(s).toMatchObject({ status: 'open', source: 'primary' });
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM weather_snapshots').first())!.n).toBe(1);
});
it('primary 500 + fallback ok ⇒ fallback status, not unknown', async () => { /* RoadClosures: 500, RoutesResults: open fixture → source 'fallback' */ });
it('all WYDOT sources fail ⇒ unknown row written (never open)', async () => { /* everything 500 ⇒ status 'unknown' */ });
it('weather failure does not block status write', async () => { /* Sensors: 500, RoadClosures ok ⇒ status row exists */ });
it('CLOSED triggers detour fetch', async () => { /* roadclosures-closed + RoutesResults?SelectedRoute=US26/US89 stubs ⇒ 2 detour_snapshots */ });
it('no travel_times insert outside polling window', async () => { /* inject nowMs param or vi.setSystemTime to 03:00 MST */ });
```

- [ ] **Step 2:** FAIL. **Step 3: Implement** — `resolveStatus`: try primary; if `status === 'unknown'` (or fetch threw), try fallback; if primary and fallback disagree on open-vs-closed, consult `parseStatewide`; agree → that status with `source: 'crosscheck'`; still unresolved → unknown. Each poll step in its own try/catch; steps: status → advisory diff vs previous snapshot (diff result logged now, used for push in P2) → weather → travel times (all 12, `Promise.allSettled`, skip outside window) → Idaho events (upsert; mark `cleared_at` for events no longer present) → detours iff closed. Wrap WYDOT fetches in a helper `wydotFetch(url, fetcher)` adding the User-Agent header, `AbortSignal.timeout(30_000)`, one 5xx retry with 2s backoff.
- [ ] **Step 4:** PASS (`npm run test:worker`). **Step 5: Commit** — `"feat: poll cycle orchestration with unknown-biased fallback chain"`

---

### Task 9: GET /api/status

**Files:**
- Create: `src/worker/api/status.ts`, `test/worker/api-status.test.ts`
- Modify: `src/worker/api/router.ts` (mount), `src/shared/types.ts` (ApiStatus)

**Interfaces:**
- Produces (`src/shared/types.ts`):
```ts
export interface ApiStatus {
  status: PassStatus;
  isStale: boolean;              // wydotReportTime older than STALE_HOURS (12)
  pollerDead: boolean;           // newest snapshot > 2h old ⇒ status forced 'unknown'
  lastConfirmed: { status: Exclude<PassStatus,'unknown'>; at: string } | null; // newest non-unknown snapshot
  conditionText: string | null; advisories: string[]; restrictions: string[];
  wydotReportTime: string | null;
  weather: WeatherReading | null;
  travelTimes: { slug: string; name: string; durationSec: number; typicalSec: number | null; capturedAt: string }[];
  id33Advisory: string | null;
  detours: { route: string; conditionText: string }[] | null; // only when closed
  alerts: PublicAlert[];         // defined in Task 10
}
```
- Route: `api.get('/status', …)`; response header `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Failing tests** — seed D1 directly, then call `api.request('/status', {}, env)`:
  - fresh open snapshot ⇒ `status:'open'`, `pollerDead:false`, `isStale:false`
  - newest snapshot 3h old ⇒ `status:'unknown'`, `pollerDead:true`, but `lastConfirmed.status:'open'` with its timestamp
  - `wydotReportTime` 13h old but snapshot fresh ⇒ `status` unchanged, `isStale:true`
  - travel time typical: with < 14 days of history in `route_typicals`-source data ⇒ `typicalSec:null`; with a `route_typicals` row matching current weekday-class/hour/season AND `MIN(captured_at)` in `travel_times` ≥ 14 days ago ⇒ number
  - unknown snapshot ⇒ `lastConfirmed` still reports the older open row
- [ ] **Step 2:** FAIL. **Step 3: Implement** — single handler; queries: newest status snapshot, newest non-unknown snapshot, newest weather, latest travel_time per route (`GROUP BY route_id` + max captured_at join `routes`), typicals lookup (weekday-class = Sat/Sun ? 'weekend':'weekday' in America/Denver; season = month in Nov–Apr ? 'winter':'summer'), active id33 event, detours iff status closed, active alerts (Task 10's query — stub `[]` until then with a `// wired in Task 10` note and a test skipped-in). Constants: `STALE_HOURS = 12`, `DEAD_HOURS = 2`, `MIN_HISTORY_DAYS = 14`.
- [ ] **Step 4:** PASS. **Step 5: Commit** — `"feat: GET /api/status with staleness + dead-poller degradation"`

---

### Task 10: Alerts API + Resend notify

**Files:**
- Create: `src/worker/api/alerts.ts`, `src/worker/notify.ts`, `src/worker/profanity.ts`, `test/worker/api-alerts.test.ts`
- Modify: `src/worker/api/router.ts`, `src/worker/api/status.ts` (wire real alerts query), `src/shared/types.ts`

**Interfaces:**
- Produces:
```ts
export interface PublicAlert { id: number; type: AlertType; note: string | null; direction: 'wb'|'eb'|null; createdAt: string; }
export type AlertType = 'crash'|'slideoff'|'slick'|'wildlife'|'stopped'|'closure'|'other';
export function sendEmail(env: Env, subject: string, text: string): Promise<void>; // Resend; swallows errors after 1 retry
export const EXPIRY_HOURS: Record<AlertType, number>; // crash:2, stopped:2, slick:3, wildlife:3, closure:1, slideoff:2, other:2
```
- Routes: `POST /api/alerts` body `{ type, note?, direction?, deviceId, website? }` (`website` = honeypot); `GET /api/alerts` → `PublicAlert[]` (active, unexpired); `POST /api/camera-error` body `{ camera }`.

- [ ] **Step 1: Failing tests**
  - POST valid ⇒ 201, row with `expires_at = created_at + EXPIRY_HOURS[type]`, hashed identifiers (`device_hash` ≠ raw deviceId, 64 hex chars)
  - honeypot filled ⇒ 200 (fake success) but NO row
  - 3rd POST same deviceId within 30 min ⇒ 429; different device same IP >5/30min ⇒ 429
  - banned device_hash ⇒ 403
  - profane note ⇒ 400
  - note > 140 chars ⇒ 400; unknown type ⇒ 400
  - GET excludes expired + removed rows
  - each accepted POST calls Resend once (stub fetcher; assert body contains type + note)
  - camera-error: second beacon same camera same day ⇒ no second email
- [ ] **Step 2:** FAIL. **Step 3: Implement** — SHA-256 via `crypto.subtle.digest` with `env.ADMIN_TOKEN`-derived salt (documented: rotating ADMIN_TOKEN rotates hashes — acceptable); rate limit by COUNT on `alerts` where `device_hash`/`ip_hash` and `created_at > now-30min` (IP from `CF-Connecting-IP`); profanity: ~30-word lowercase list, substring match on normalized note; `sendEmail` POSTs `https://api.resend.com/emails` `{ from: 'alerts@tetonpasscam.com', to: env.ADMIN_EMAIL, subject, text }`. Camera-error throttle: `SELECT` newest camera-error… store beacons in `feedback`? No — add nothing: keep an in-memory Map? Workers isolates reset — use a `camera_errors(camera, day)` UNIQUE insert-or-ignore table added via new migration in this task. Wire real alerts into `/api/status` and un-skip its test.
- [ ] **Step 4:** PASS. **Step 5: Commit** — `"feat: community alerts with anti-abuse + resend notifications"`

---

### Task 11: Feedback API

**Files:**
- Create: `src/worker/api/feedback.ts`, `test/worker/api-feedback.test.ts`
- Modify: `src/worker/api/router.ts`

**Interfaces:** `POST /api/feedback` body `{ body: string; email?: string }` ⇒ 201; row in `feedback`; one `sendEmail` call.

- [ ] **Step 1: Failing tests** — valid ⇒ 201 + row + email sent (stubbed); empty body ⇒ 400; body > 2000 chars ⇒ 400; email present ⇒ stored.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (10 lines in Hono). **Step 4:** PASS. **Step 5: Commit** — `"feat: feedback endpoint"`

---

### Task 12: Nightly aggregation + retention + GET /api/history

**Files:**
- Create: `src/worker/poller/aggregate.ts`, `src/worker/api/history.ts`, `test/worker/aggregate.test.ts`
- Modify: `src/worker/index.ts` (dispatcher calls `runNightly`), `src/worker/api/router.ts`

**Interfaces:**
```ts
export function runNightly(env: Env): Promise<void>;
// rebuilds route_typicals: for each (route, weekday_class, hour, season): median, p25, p75 of duration_sec
// then prunes: status/weather/detour snapshots > 2y; expired alerts flipped to status 'expired'
```
- `GET /api/history?route=<slug>` ⇒ `{ route, typicals: { weekdayClass, season, hour, medianSec, p25Sec, p75Sec }[], today: { capturedAt, durationSec }[] }`; 404 unknown slug.

- [ ] **Step 1: Failing tests** — seed 3 weeks of synthetic `travel_times` for one route (two known distributions: weekday-hour-7 durations [1800,1900,2000,2100,2200] ⇒ median 2000, p25 1900, p75 2100 with nearest-rank); `runNightly` twice is idempotent (DELETE+rebuild); rows older than 2y pruned from `status_snapshots` but `travel_times` untouched; `/api/history?route=victor-jackson-eb` returns typicals + today's points; bad slug ⇒ 404.
- [ ] **Step 2:** FAIL. **Step 3: Implement** — one SQL pass per dimension combo computed in TS (pull durations per group, sort, nearest-rank percentiles — groups are small); season/weekday-class derived from `captured_at` in America/Denver via the Task 6 `Intl` helper (export it from a new `src/worker/tz.ts`, refactor google-routes to import it).
- [ ] **Step 4:** PASS. **Step 5: Commit** — `"feat: nightly typicals aggregation, retention, history endpoint"`

---

### Task 13: Admin API + page

**Files:**
- Create: `src/worker/api/admin.ts`, `src/app/admin.html` (static, served at /admin via assets), `test/worker/api-admin.test.ts`
- Modify: `src/worker/api/router.ts`, `vite.config.ts` (multi-page input for admin.html)

**Interfaces:** all under `/api/admin`, require header `Authorization: Bearer <ADMIN_TOKEN>`: `GET /alerts` (all incl. expired/removed, with hashes), `DELETE /alerts/:id` (status → 'removed'), `POST /bans` `{ deviceHash?, ipHash? }`, `GET /feedback`.

- [ ] **Step 1: Failing tests** — no/wrong token ⇒ 401 on every route; delete flips status to `removed` (row kept); ban row inserted then POST /api/alerts from that hash ⇒ 403; feedback listed newest-first.
- [ ] **Step 2:** FAIL. **Step 3: Implement** — Hono sub-app with bearer middleware; `admin.html` = single vanilla-JS page (token via prompt(), stored sessionStorage; tables for alerts/feedback; delete + ban buttons calling the API). No framework — it's a crude internal tool by design.
- [ ] **Step 4:** PASS. **Step 5: Commit** — `"feat: admin moderation api + page"`

---

### Task 14: Frontend — status banner, weather, drive times

**Files:**
- Create: `src/app/api.ts`, `src/app/useStatus.ts`, `src/app/components/StatusBanner.tsx`, `src/app/components/DetourBlock.tsx`, `src/app/components/DriveTimes.tsx`, `src/app/components/WeatherStrip.tsx`, `test/app/StatusBanner.test.tsx` (vitest + @testing-library/react, jsdom env — add `vitest.app.config.ts` + `npm run test:app`)
- Modify: `src/app/App.tsx`, `src/app/index.css`

**Interfaces:**
- Consumes: `ApiStatus` from `src/shared/types.ts` via `getStatus(): Promise<ApiStatus>` in `api.ts` (plain `fetch('/api/status')`).
- Produces: `useStatus()` hook — fetch on mount + every 120s + on `visibilitychange`; returns `{ data, error, refreshedAt }`, keeps last data in `localStorage('last-status')` for the offline shell.

- [ ] **Step 1: Failing component tests**

```tsx
it('renders CLOSED with legal copy and detour block', () => {
  render(<StatusBanner data={{ ...base, status: 'closed', detours: [{ route: 'US26', conditionText: 'Wet' }] }} />);
  expect(screen.getByText(/Closed — do not attempt/)).toBeInTheDocument();
  expect(screen.getByText(/up to \$750 fine/)).toBeInTheDocument();
  expect(screen.getByText(/Swan Valley/)).toBeInTheDocument();
});
it('renders RESTRICTED with the restriction named', () => { /* restrictions:['Chain Law Level 1'] appears */ });
it('renders UNKNOWN with 511 link', () => { /* href contains wyoroad.info */ });
it('always shows last-confirmed line', () => { /* "last confirmed open" + formatted time */ });
it('never renders a reopening estimate element', () => { /* no text matching /reopen|estimate/i in closed state */ });
it('drive time row hides delta when typicalSec null, shows ±min colored when present', () => { /* green ≤ -5min? spec: delta color green/amber/red: implement thresholds delta ≤ +5min green, +5–15 amber, >15 red */ });
```

- [ ] **Step 2:** FAIL. **Step 3: Implement** — `StatusBanner`: full-width block, colors `bg-green-600/amber-500/red-600/gray-500` (+ dark variants), status word huge (`text-5xl font-black`), restriction text under RESTRICTED, last-report + last-confirmed lines always visible, `isStale` renders an amber "Data may be outdated — last WYDOT report {time}" chip, `pollerDead` forces the UNKNOWN presentation. `DriveTimes`: rows per visible direction with flip toggle (`eb`/`wb` state), delta chip. `WeatherStrip`: 5 stat tiles, surface temp first Nov–Apr. Mobile-first, dark mode via Tailwind `dark:` + `media` strategy.
- [ ] **Step 4:** PASS (`npm run test:app`). **Step 5: Commit** — `"feat: home screen top half (banner, drive times, weather)"`

---

### Task 15: Frontend — alerts strip, report modal, cams, sponsor, footer

**Files:**
- Create: `src/app/components/AlertsStrip.tsx`, `src/app/components/ReportModal.tsx`, `src/app/components/Cameras.tsx`, `src/app/components/Sponsor.tsx`, `src/app/components/Footer.tsx`, `src/app/deviceId.ts`, `src/app/cameras.ts` (the 3 WYDOT URLs — **placeholder constants + TODO(drew) comment until Drew supplies the tetonflats.com URLs**; onerror path works regardless), `test/app/ReportModal.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `POST /api/alerts` contract from Task 10; `deviceId.ts` exports `getDeviceId()` (random UUID persisted in localStorage).

- [ ] **Step 1: Failing tests** — ReportModal: renders 7 type buttons; submit posts `{ type, note, direction, deviceId }` + honeypot field left empty (assert stub fetch body); note input enforces `maxLength=140`; success state closes modal and shows toast; 429 response shows "You're reporting too often" message. AlertsStrip: renders "Unverified community report" label per item and the exact empty state `No reports in the last 3 hours.`; age rendered as "18 min ago".
- [ ] **Step 2:** FAIL. **Step 3: Implement** — persistent bottom-right fixed `⚠ Report conditions` button (thumb-reachable, `bottom-4 inset-x-4` on mobile); modal = type grid (2 taps: type → submit) + optional note/direction; hidden `website` input (honeypot). `Cameras`: 3 `<img loading="lazy">` with caption + timestamp + link to wyoroad.info, `onerror` → link-card swap + `navigator.sendBeacon('/api/camera-error', …)` once per session per camera. `Sponsor`: exact copy + UTM URL from spec. `Footer`: WY 511, ID 511, START bus, 511 Notify (`511notify.wyoroad.info`), privacy policy link (`/privacy.html` — write a short static page: what's stored = hashed identifiers, optional email, no accounts), feedback link opening a mini modal posting to `/api/feedback`, "Not affiliated with WYDOT".
- [ ] **Step 4:** PASS. **Step 5: Commit** — `"feat: alerts strip, report modal, cams, sponsor, footer, privacy"`

---

### Task 16: SEO shell + PWA + offline

**Files:**
- Modify: `index.html`, `vite.config.ts` (vite-plugin-pwa), `src/app/useStatus.ts` (offline fallback path), `src/app/App.tsx` (stale offline banner)
- Create: `public/robots.txt`, `public/sitemap.xml`, `public/icons/*` (generate 192/512 PNGs from a simple mountain/road glyph)

**Interfaces:** none new — this task is config + markup.

- [ ] **Step 1: index.html head (verbatim per spec)** — `<title>Teton Pass Cam — Live Cameras, Conditions & Drive Times</title>`; meta description per spec; `<h1>Teton Pass — live cams & conditions</h1>` in the static shell markup with the 100–150-word explainer paragraph (write it: what the site shows, sources, update cadence, not-affiliated note) — visible pre-hydration, React mounts into a sibling div; FAQPage JSON-LD with the two spec questions.
- [ ] **Step 2: PWA** — vite-plugin-pwa: `registerType: 'autoUpdate'`, manifest (name "Teton Pass Cam", theme colors, icons), workbox runtime caching: `/api/status` NetworkFirst with 10s timeout + fallback to cache; app shell precached. Offline: `useStatus` on fetch failure reads `localStorage('last-status')` and sets `data.offline = true`; App renders a prominent red "OFFLINE — showing last known status from {time}" banner.
- [ ] **Step 3: Verify** — `npm run build && npx wrangler dev`; `curl -s localhost:8787 | grep -c 'Teton Pass Cam\|live cams'` ≥ 2; Lighthouse (chrome devtools or `npx lighthouse http://localhost:8787 --preset=mobile`) PWA installable + perf ≥ 90 locally.
- [ ] **Step 4: Commit** — `"feat: seo shell, pwa manifest, offline last-known status"`

---

### Task 17: Deploy + definition-of-done verification

**Files:**
- Create: `scripts/verify-launch.sh`, `docs/RUNBOOK.md`
- Modify: `wrangler.toml` (real D1 database_id), `CLAUDE.md` (commands section)

- [ ] **Step 1: Provision** — `npx wrangler d1 create tetonpasscam` (paste id into wrangler.toml); `npx wrangler d1 migrations apply tetonpasscam --remote`; seed routes remotely (one-off `wrangler d1 execute` with the seed SQL); `wrangler secret put` × 4 (Drew supplies values); `npm run deploy`; attach tetonpasscam.com custom domain in CF dashboard (Drew).
- [ ] **Step 2: verify-launch.sh** — curl checks: `/` contains title + H1 + meta description; `/api/status` returns JSON with a `status` field; POST `/api/alerts` × 3 same deviceId ⇒ third is 429; `/robots.txt` 200; `/sitemap.xml` 200. Echo PASS/FAIL per check, exit non-zero on any FAIL.
- [ ] **Step 3: Kill-poller drill** — documented in RUNBOOK (can't easily automate): temporarily remove cron triggers, deploy, wait 2h → `/api/status` reports `unknown` + `pollerDead:true`; restore. RUNBOOK also covers: rotating secrets, reading poller logs (`wrangler tail`), updating camera URLs, seasonal cadence change (edit crons), D1 backup (`wrangler d1 export` monthly).
- [ ] **Step 4: Capacitor smoke check** — `npx cap init` NOT run in P1; instead verify no Node/SSR APIs in `src/app` (grep for `process.`, `fs`, `__dirname` — expect zero hits) and record in RUNBOOK that `npx cap sync` onboarding is P2's first task.
- [ ] **Step 5: Update CLAUDE.md** — replace "Repository state: pre-implementation" section with the real command list (dev/test/deploy/migrations) and repo map.
- [ ] **Step 6: Commit** — `"chore: launch verification script, runbook, deploy config"`

---

## Prerequisites Drew owns (blockers flagged per task)

- Google Routes API key (Task 8 live runs; tests don't need it) + $200 billing alert
- Idaho 511 key (Task 8 live)
- Resend account + tetonpasscam.com domain verification (Task 10 live; tests stub it)
- Camera image URLs from tetonflats.com (Task 15 placeholders until then)
- Cloudflare account/domain DNS (Task 17)

## Self-Review Results

- **Spec coverage:** all design-doc sections map to tasks (schema→2, poller rules→3–8, API→9–13, frontend→14–15, SEO/PWA→16, DoD→17). History *screen* is P2 by design; endpoint ships in Task 12. Push notifications P2. ✓
- **Placeholder scan:** two intentional, flagged, Drew-blocked placeholders (camera URLs, D1 database_id) — both marked with owner and unblock path. No TBDs elsewhere. ✓
- **Type consistency:** `StatusResult` (T3) consumed by T4/T8; `WeatherReading` (T5) reused in `ApiStatus` (T9); `SeedRoute`/`ROUTES` (T2) consumed by T6/T8; `PublicAlert` (T10) referenced by T9 with explicit wiring step in T10. `EXPIRY_HOURS` includes all 7 alert types. ✓

