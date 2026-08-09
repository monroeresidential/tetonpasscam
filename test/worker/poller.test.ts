import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { seedRoutes } from '../../src/worker/db/seed-routes';
import { fetchDetours, resolveStatus, runPollCycle } from '../../src/worker/poller/run';

// Fixture HTML is loaded via Vite's `?raw` import suffix rather than
// `node:fs.readFileSync` (the pattern test/parsers/*.test.ts uses): this
// file runs under @cloudflare/vitest-pool-workers, which executes tests
// INSIDE a Workers runtime sandbox with no filesystem access at runtime.
// `?raw` imports are resolved to plain string constants at bundle time
// (before the code ever reaches the Workers runtime), so the resulting
// import is just a string by the time the test executes -- confirmed
// working here via a standalone smoke test before writing the rest of this
// suite. `vite/client.d.ts` (pulled in via the `vite/client` tsconfig
// `types` entry) already declares the `*?raw` module shape, so no extra
// type declaration file is needed.
import roadclosuresClosed from '../fixtures/roadclosures-closed.html?raw';
import roadclosuresOpen from '../fixtures/roadclosures-open.html?raw';
import routesresultsWy22Open from '../fixtures/routesresults-wy22.html?raw';
import sensorsTetonpass from '../fixtures/sensors-tetonpass.html?raw';

// Minimal synthetic RoutesResults-shaped fragments for the two detour
// routes (US26, US89). These are different highway segments than the WY22
// Wilson-Stateline row the real parseRoutesResults hardcodes, so no live
// fixture from Task 4 applies here -- fetchDetours does its own minimal
// "*cond" cell extraction (see run.ts), which only needs this much shape.
const us26ClosedHtml =
  '<html><body><table><tr><td class="closurelocation">Between Alpine Jct and Hoback Jct</td>' +
  '<td class="closedcond">CLOSED due to Avalanche Control</td></tr></table></body></html>';
const us89ClosedHtml =
  '<html><body><table><tr><td class="closurelocation">Between the Idaho State Line and Afton</td>' +
  '<td class="closedcond">CLOSED due to High Water</td></tr></table></body></html>';

const GOOGLE_ROUTES_STUB = JSON.stringify({
  routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }],
});

// 2026-08-09T18:00:00.000Z = noon MDT (America/Denver is UTC-6 in August) --
// safely inside the 05:00-23:00 Denver polling window regardless of what
// wall-clock time the test happens to run at.
const IN_WINDOW_NOW_MS = Date.parse('2026-08-09T18:00:00.000Z');
// 2026-08-09T09:00:00.000Z = 03:00 MDT -- outside the polling window.
const OUT_OF_WINDOW_NOW_MS = Date.parse('2026-08-09T09:00:00.000Z');

function fakeFetch(map: Record<string, string | number>) {
  return async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    const hit = Object.entries(map).find(([k]) => u.includes(k));
    if (!hit) return new Response('not stubbed', { status: 500 });
    return typeof hit[1] === 'number' ? new Response('err', { status: hit[1] }) : new Response(hit[1]);
  };
}

beforeAll(async () => {
  await seedRoutes(env.DB);
});

describe('runPollCycle', () => {
  it('happy path writes status+weather rows, one per cycle', async () => {
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': '[]',
      }),
      IN_WINDOW_NOW_MS,
    );
    const s = await env.DB.prepare(
      'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
    ).first();
    expect(s).toMatchObject({ status: 'open', source: 'primary' });
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM weather_snapshots').first())!.n).toBe(1);
  });

  it(
    'primary 500 + fallback ok ⇒ fallback status, not unknown',
    async () => {
      await runPollCycle(
        env as any,
        fakeFetch({
          'RoadClosures.html': 500,
          'SelectedRoute=WY22': routesresultsWy22Open,
          'Sensors.StationResults': sensorsTetonpass,
          'routes.googleapis.com': GOOGLE_ROUTES_STUB,
          '511.idaho.gov': '[]',
        }),
        IN_WINDOW_NOW_MS,
      );
      const s = await env.DB.prepare(
        'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
      ).first();
      expect(s).toMatchObject({ status: 'open', source: 'fallback' });
    },
    20_000,
  );

  it(
    'all WYDOT sources fail ⇒ unknown row written (never open)',
    async () => {
      await runPollCycle(env as any, fakeFetch({}), IN_WINDOW_NOW_MS);
      const s = await env.DB.prepare(
        'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
      ).first();
      expect(s).toMatchObject({ status: 'unknown' });
      expect((s as any).status).not.toBe('open');
    },
    20_000,
  );

  it(
    'weather failure does not block status write',
    async () => {
      await runPollCycle(
        env as any,
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'Sensors.StationResults': 500,
          'routes.googleapis.com': GOOGLE_ROUTES_STUB,
          '511.idaho.gov': '[]',
        }),
        IN_WINDOW_NOW_MS,
      );
      const s = await env.DB.prepare(
        'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
      ).first();
      expect(s).toMatchObject({ status: 'open', source: 'primary' });
    },
    20_000,
  );

  it('CLOSED triggers detour fetch', async () => {
    const beforeCount = (await env.DB.prepare('SELECT COUNT(*) n FROM detour_snapshots').first())!
      .n as number;
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresClosed,
        'SelectedRoute=US26': us26ClosedHtml,
        'SelectedRoute=US89': us89ClosedHtml,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': '[]',
      }),
      IN_WINDOW_NOW_MS,
    );
    const s = await env.DB.prepare(
      'SELECT status FROM status_snapshots ORDER BY id DESC LIMIT 1',
    ).first();
    expect(s).toMatchObject({ status: 'closed' });
    const afterCount = (await env.DB.prepare('SELECT COUNT(*) n FROM detour_snapshots').first())!
      .n as number;
    expect(afterCount - beforeCount).toBe(2);
  });

  it('no travel_times insert outside polling window', async () => {
    const beforeCount = (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first())!
      .n as number;
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': '[]',
      }),
      OUT_OF_WINDOW_NOW_MS,
    );
    const afterCount = (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first())!
      .n as number;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('resolveStatus', () => {
  it(
    'resolves to unknown, never open, when every source fails',
    async () => {
      const result = await resolveStatus(fakeFetch({}));
      expect(result.status).toBe('unknown');
    },
    20_000,
  );
});

describe('fetchDetours', () => {
  it('returns an entry per reachable detour route', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': us26ClosedHtml,
        'SelectedRoute=US89': us89ClosedHtml,
      }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.route).sort()).toEqual(['US26', 'US89']);
  });

  it('omits a route whose fetch fails rather than fabricating an entry', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': us26ClosedHtml,
        'SelectedRoute=US89': 500,
      }),
    );
    expect(result).toEqual([{ route: 'US26', conditionText: 'CLOSED due to Avalanche Control' }]);
  }, 10_000);
});
