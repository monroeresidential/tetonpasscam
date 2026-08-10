import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
import roadclosuresRestricted from '../fixtures/roadclosures-restricted.html?raw';
import routesresultsWy22Closed from '../fixtures/routesresults-wy22-closed.html?raw';
import routesresultsWy22Open from '../fixtures/routesresults-wy22.html?raw';
import sensorsTetonpass from '../fixtures/sensors-tetonpass.html?raw';
import statewideClosed from '../fixtures/statewide-closed.html?raw';

import { parseRoadClosures, parseRoutesResults, SEGMENT_TEXT } from '../../src/worker/poller/wydot-status';

// Same page shape as routesresultsWy22Open (Wilson-Stateline row: cond class
// "lowimpactcond" / "Dry", i.e. open-axis), but with the always-present
// weight-limit boilerplate in the *restrict* cell swapped for an actual
// RESTRICTION_RX-matching restriction -- exercises the "primary open +
// fallback restricted" agreeing-but-more-restrictive matrix cell. No
// standalone fixture file exists for this combination (RoutesResults-shaped
// + chain-law-restricted is not one of the captured/hand-edited fixtures),
// so it's derived here via the same "change only the cell that matters"
// convention the hand-edited fixtures themselves follow.
//
// The weight-limit boilerplate text is NOT unique in this page -- an
// earlier, unrelated segment's row carries the identical text -- so the
// replacement is anchored to only the text AFTER the Wilson-Stateline
// SEGMENT_TEXT marker, otherwise a plain .replace() would silently patch
// the wrong row's cell (the earlier segment's, not ours) and leave our
// target row's restrictions empty.
const segmentMarkerIdx = routesresultsWy22Open.indexOf(SEGMENT_TEXT);
const routesresultsWy22Restricted =
  routesresultsWy22Open.slice(0, segmentMarkerIdx) +
  routesresultsWy22Open
    .slice(segmentMarkerIdx)
    .replace(
      'WY 22 from milepost 6.000 to 17.490<br />Weight restriction: 60000 lbs',
      'Chain Law Level 1',
    );

// Same restricted-fallback derivation as above, but ALSO swaps the impact
// ("*impact") cell's advisory text so this fixture's own advisory differs
// from roadclosuresOpen's ('Falling Rock') -- exercises mergeAgreeing's
// "advisories from the winning side only" rule (LH T1-review minor 1):
// with routesresultsWy22Restricted alone, both sides happen to report the
// SAME advisory, so a union-vs-winning-side bug would be invisible.
const routesresultsWy22RestrictedDistinctAdvisory = routesresultsWy22Restricted.replace(
  'Falling Rock',
  'Slick Spots',
);

// mergeAgreeing's wydotReportTime is the OLDER of primary's/fallback's own
// report times (LH T1-review minor 1), not always primary's -- these two
// variants of the fallback page each shift its "Last Report Time" cell
// relative to roadclosuresOpen's fixed "Aug 9, 2026, 08:51 AM", one later
// and one earlier, so a test can prove the merge picks whichever is
// actually older rather than defaulting to a fixed side.
const routesresultsWy22OpenLaterReport =
  routesresultsWy22Open.slice(0, segmentMarkerIdx) +
  routesresultsWy22Open.slice(segmentMarkerIdx).replace('Aug 9, 2026, 08:51 AM', 'Aug 9, 2026, 09:15 AM');
const routesresultsWy22OpenEarlierReport =
  routesresultsWy22Open.slice(0, segmentMarkerIdx) +
  routesresultsWy22Open.slice(segmentMarkerIdx).replace('Aug 9, 2026, 08:51 AM', 'Aug 9, 2026, 08:10 AM');

// Synthetic, multi-segment RoutesResults-shaped fragments for the two
// detour routes (US26, US89). Deliberately NOT single-row: a real
// SelectedRoute=US26/US89 page can list several segments statewide for that
// route number (mirroring the two-row WY22 fixture from Task 4), and an
// extraction that only ever looked at the first "*cond" cell on the page
// would silently report an arbitrary, possibly unrelated, segment. These
// fixtures put the meaningful row SECOND (or omit a closure entirely) so a
// regression back to "first cell wins" fails the assertions below.
//
// US26: a decoy first segment that's open, then the real closure.
const us26MultiSegmentHtml =
  '<html><body><table>' +
  '<tr><td class="closurelocation">Between Jackson and Hoback Jct</td>' +
  '<td class="lowimpactcond">Dry</td></tr>' +
  '<tr><td class="closurelocation">Between Alpine Jct and Hoback Jct</td>' +
  '<td class="closedcond">CLOSED due to Avalanche Control</td></tr>' +
  '</table></body></html>';
// US89: no closure at all -- multiple non-closed segments, expect a joined summary.
const us89MultiSegmentHtml =
  '<html><body><table>' +
  '<tr><td class="closurelocation">Between the Idaho State Line and Afton</td>' +
  '<td class="modimpactcond">Falling Rock</td></tr>' +
  '<tr><td class="closurelocation">Between Afton and Alpine Jct</td>' +
  '<td class="noimpactcond">Dry</td></tr>' +
  '</table></body></html>';

const GOOGLE_ROUTES_STUB = JSON.stringify({
  routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }],
});

// 2026-08-09T18:00:00.000Z = noon MDT (America/Denver is UTC-6 in August) --
// safely inside the 05:00-23:00 Denver polling window regardless of what
// wall-clock time the test happens to run at.
const IN_WINDOW_NOW_MS = Date.parse('2026-08-09T18:00:00.000Z');
// 2026-08-09T09:00:00.000Z = 03:00 MDT -- outside the polling window.
const OUT_OF_WINDOW_NOW_MS = Date.parse('2026-08-09T09:00:00.000Z');

// `capturedUrls`, when passed, has every requested URL pushed onto it --
// used to observe which sources a cycle actually fetched (e.g. asserting the
// fallback page is requested even on a cycle where primary alone would have
// been enough to resolve a status pre-fix).
function fakeFetch(map: Record<string, string | number>, capturedUrls?: string[]) {
  return async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    capturedUrls?.push(u);
    const hit = Object.entries(map).find(([k]) => u.includes(k));
    if (!hit) return new Response('not stubbed', { status: 500 });
    return typeof hit[1] === 'number' ? new Response('err', { status: hit[1] }) : new Response(hit[1]);
  };
}

beforeAll(async () => {
  await seedRoutes(env.DB);
});

describe('runPollCycle', () => {
  it('happy path writes status+weather rows, one per cycle, and all 12 travel times', async () => {
    const beforeTravelCount = (
      (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first()) as any
    ).n as number;
    const requestedUrls: string[] = [];
    await runPollCycle(
      env as any,
      fakeFetch(
        {
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22Open,
          'Sensors.StationResults': sensorsTetonpass,
          'routes.googleapis.com': GOOGLE_ROUTES_STUB,
          '511.idaho.gov': '[]',
        },
        requestedUrls,
      ),
      IN_WINDOW_NOW_MS,
    );
    const s = await env.DB.prepare(
      'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
    ).first();
    // Primary and fallback both agree (open+open), so 'primary' still wins
    // as the reported source -- but the assertion below on requestedUrls is
    // the one that actually proves the fallback page was fetched at all.
    expect(s).toMatchObject({ status: 'open', source: 'primary' });
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM weather_snapshots').first())!.n).toBe(1);
    // LH T2 finding 4 survey: reported_at must hold the parser's own WYDOT
    // report time (sensorsTetonpass's page text says "Aug 9, 2026, 11:10
    // AM" -- distinct from IN_WINDOW_NOW_MS's captured_at, "...T18:00:00Z"),
    // not a copy of captured_at.
    const weatherRow = (await env.DB
      .prepare('SELECT captured_at AS capturedAt, reported_at AS reportedAt FROM weather_snapshots ORDER BY id DESC LIMIT 1')
      .first()) as { capturedAt: string; reportedAt: string | null };
    expect(weatherRow.reportedAt).not.toBeNull();
    expect(weatherRow.reportedAt).not.toBe(weatherRow.capturedAt);
    const afterTravelCount = (
      (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first()) as any
    ).n as number;
    expect(afterTravelCount - beforeTravelCount).toBe(12);
    // The core P0 fix: fallback (RoutesResults) must be fetched every cycle,
    // even when primary alone already resolved to a definite status --
    // never only "when primary was unknown" as it was pre-fix.
    expect(requestedUrls.some((u) => u.includes('SelectedRoute=WY22'))).toBe(true);
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
          'SelectedRoute=WY22': routesresultsWy22Open,
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
        'SelectedRoute=WY22': routesresultsWy22Closed,
        'SelectedRoute=US26': us26MultiSegmentHtml,
        'SelectedRoute=US89': us89MultiSegmentHtml,
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

  it(
    'primary+fallback failure with Statewide closed ⇒ crosscheck status (never open)',
    async () => {
      const s = await env.DB.prepare(
        'SELECT COUNT(*) n FROM status_snapshots WHERE source = ?',
      )
        .bind('crosscheck')
        .first();
      const beforeCrosscheckCount = (s as any).n as number;
      await runPollCycle(
        env as any,
        fakeFetch({
          'RoadClosures.html': 500,
          'SelectedRoute=WY22': 500,
          'MEDIA.Statewide': statewideClosed,
          'Sensors.StationResults': sensorsTetonpass,
          'routes.googleapis.com': GOOGLE_ROUTES_STUB,
          '511.idaho.gov': '[]',
        }),
        IN_WINDOW_NOW_MS,
      );
      const row = await env.DB.prepare(
        'SELECT status, source FROM status_snapshots ORDER BY id DESC LIMIT 1',
      ).first();
      expect(row).toMatchObject({ status: 'closed', source: 'crosscheck' });
      expect((row as any).status).not.toBe('open');
      const afterCrosscheckCount = (
        (await env.DB.prepare('SELECT COUNT(*) n FROM status_snapshots WHERE source = ?')
          .bind('crosscheck')
          .first()) as any
      ).n as number;
      expect(afterCrosscheckCount - beforeCrosscheckCount).toBe(1);
    },
    20_000,
  );

  it('no travel_times insert outside polling window', async () => {
    const beforeCount = (await env.DB.prepare('SELECT COUNT(*) n FROM travel_times').first())!
      .n as number;
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
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

  // Decision matrix (LH T1 -- P0 fix): fallback is now fetched EVERY cycle,
  // not just when primary is unknown, so a definite primary and a definite
  // fallback can disagree and that disagreement must be caught -- never
  // silently resolved as 'open' just because primary alone said so.

  it(
    'primary open + fallback closed + statewide closed ⇒ closed via crosscheck (never open)',
    async () => {
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22Closed,
          'MEDIA.Statewide': statewideClosed,
        }),
      );
      expect(result.status).toBe('closed');
      expect(result.source).toBe('crosscheck');
    },
    20_000,
  );

  it(
    'primary open + fallback closed + statewide unresolved ⇒ unknown (never open)',
    async () => {
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22Closed,
          // MEDIA.Statewide deliberately unstubbed -- 500s, so the
          // crosscheck itself can't resolve the disagreement either.
        }),
      );
      expect(result.status).toBe('unknown');
      // Pins the distinct 'unresolved' label for this path -- separate from
      // the both-primary-and-fallback-unknown path, which keeps its
      // historical 'primary' label (see resolveStatus's doc comment).
      expect(result.source).toBe('unresolved');
    },
    20_000,
  );

  it(
    'primary closed + fallback open + statewide unresolved ⇒ unknown',
    async () => {
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresClosed,
          'SelectedRoute=WY22': routesresultsWy22Open,
        }),
      );
      expect(result.status).toBe('unknown');
    },
    20_000,
  );

  it('primary open + fallback open ⇒ open, source primary, advisories from primary (both sides happen to agree here)', async () => {
    const result = await resolveStatus(
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
      }),
    );
    expect(result.status).toBe('open');
    expect(result.source).toBe('primary');
    expect(result.advisories).toEqual(['Falling Rock']);
  });

  it(
    'primary open + fallback restricted ⇒ restricted, more-restrictive wins, restrictions merged',
    async () => {
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22Restricted,
        }),
      );
      expect(result.status).toBe('restricted');
      expect(result.source).toBe('primary');
      expect(result.restrictions).toEqual(['Chain Law Level 1']);
    },
  );

  it(
    "mergeAgreeing: advisories come from the winning side only, not a union of both sources (LH T1-review minor 1)",
    async () => {
      // primary (roadclosuresOpen) reports advisory 'Falling Rock' but LOSES
      // the passAxis (its status is 'open'); fallback reports a distinct
      // advisory 'Slick Spots' and WINS (its status, 'restricted', is the
      // merged status) -- the merged advisories must be fallback's alone.
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22RestrictedDistinctAdvisory,
        }),
      );
      expect(result.status).toBe('restricted');
      expect(result.advisories).toEqual(['Slick Spots']);
      expect(result.advisories).not.toContain('Falling Rock');
      // Restrictions are unaffected by this rule -- still a deduped union
      // of both sources (pinned by the test above).
      expect(result.restrictions).toEqual(['Chain Law Level 1']);
    },
  );

  it(
    'mergeAgreeing: wydotReportTime is the OLDER of the two sources, not always primary\'s (LH T1-review minor 1)',
    async () => {
      // Fallback's report time (09:15 AM) is LATER than primary's (08:51
      // AM) -- the merged result must still be primary's, since primary is
      // the older/less-current of the two. (Coincides with the historical
      // "primary always wins" behavior, so this alone wouldn't catch a
      // regression back to it -- the next test does.)
      const laterFallback = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22OpenLaterReport,
        }),
      );
      const primaryOnly = parseRoadClosures(roadclosuresOpen);
      expect(laterFallback.wydotReportTime).toBe(primaryOnly.wydotReportTime);

      // Fallback's report time (08:10 AM) is EARLIER than primary's (08:51
      // AM) -- the merged result must now be fallback's, proving this
      // ISN'T "always primary's" (the pre-fix behavior).
      const earlierFallback = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresOpen,
          'SelectedRoute=WY22': routesresultsWy22OpenEarlierReport,
        }),
      );
      const fallbackOnly = parseRoutesResults(routesresultsWy22OpenEarlierReport);
      expect(earlierFallback.wydotReportTime).toBe(fallbackOnly.wydotReportTime);
      expect(earlierFallback.wydotReportTime).not.toBe(primaryOnly.wydotReportTime);
    },
  );

  it(
    'primary restricted + fallback unknown ⇒ restricted, source primary (fallback failure does not degrade a healthy primary)',
    async () => {
      const result = await resolveStatus(
        fakeFetch({
          'RoadClosures.html': roadclosuresRestricted,
          // SelectedRoute=WY22 deliberately unstubbed -- fallback fetch fails.
        }),
      );
      expect(result.status).toBe('restricted');
      expect(result.source).toBe('primary');
    },
    20_000,
  );
});

describe('fetchDetours', () => {
  it('returns an entry per reachable detour route', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': us26MultiSegmentHtml,
        'SelectedRoute=US89': us89MultiSegmentHtml,
      }),
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.route).sort()).toEqual(['US26', 'US89']);
  });

  it('prefers the closed segment over an earlier open one, not just the first cell on the page', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': us26MultiSegmentHtml,
        'SelectedRoute=US89': 500,
      }),
    );
    expect(result).toEqual([
      { route: 'US26', conditionText: 'Between Alpine Jct and Hoback Jct: CLOSED due to Avalanche Control' },
    ]);
  }, 10_000);

  it('joins multiple non-closed segments when no segment is closed', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': 500,
        'SelectedRoute=US89': us89MultiSegmentHtml,
      }),
    );
    expect(result).toEqual([
      {
        route: 'US89',
        conditionText:
          'Between the Idaho State Line and Afton: Falling Rock; Between Afton and Alpine Jct: Dry',
      },
    ]);
  }, 10_000);

  it('omits a route whose fetch fails rather than fabricating an entry', async () => {
    const result = await fetchDetours(
      fakeFetch({
        'SelectedRoute=US26': us26MultiSegmentHtml,
        'SelectedRoute=US89': 500,
      }),
    );
    expect(result).toEqual([
      { route: 'US26', conditionText: 'Between Alpine Jct and Hoback Jct: CLOSED due to Avalanche Control' },
    ]);
  }, 10_000);
});

describe('advisory diff churn avoidance', () => {
  it('an unknown cycle between two good reads does not manufacture an advisory diff', async () => {
    // Seed a controlled "prior good cycle" row directly, independent of
    // whatever earlier tests in this file have already written, so this
    // test's assertions don't depend on execution order.
    const seededAt = new Date(IN_WINDOW_NOW_MS - 60_000).toISOString();
    await env.DB
      .prepare(
        `INSERT INTO status_snapshots
           (captured_at, segment, status, condition_text, advisories, restrictions, wydot_report_time, source)
         VALUES (?, 'wilson-stateline', 'open', 'Road Open', ?, '[]', NULL, 'primary')`,
      )
      .bind(seededAt, JSON.stringify(['Falling Rock']))
      .run();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Cycle 1: every source fails -> 'unknown'. Without the fix, this
      // would diff the seeded ['Falling Rock'] against the unknown cycle's
      // synthetic [] and log a spurious "removed: Falling Rock" event.
      await runPollCycle(env as any, fakeFetch({}), IN_WINDOW_NOW_MS);
      // Cycle 2: a good read again, with the SAME standing advisory. Without
      // the fix, this would diff against cycle 1's synthetic [] and log a
      // spurious "added: Falling Rock" event, even though nothing changed
      // across the two real reads.
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
      const diffCalls = logSpy.mock.calls.filter(([msg]) => msg === '[poller] advisory diff');
      expect(diffCalls).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  }, 20_000);
});

describe('Idaho 511 event upsert semantics', () => {
  it('a fetch failure (null) leaves an existing active event untouched', async () => {
    const eventId = 'id33-test-null-path';
    const seedEvent = JSON.stringify([
      {
        ID: eventId,
        RoadwayName: 'ID-33',
        Description: 'Seeded active event',
        IsFullClosure: true,
        Latitude: 43.6,
        Longitude: -111.1,
      },
    ]);
    // Seed one active event via a successful cycle.
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': seedEvent,
      }),
      IN_WINDOW_NOW_MS,
    );
    const before = await env.DB.prepare(
      'SELECT cleared_at FROM id33_events WHERE event_id = ?',
    )
      .bind(eventId)
      .first();
    expect((before as any).cleared_at).toBeNull();

    // A failed Idaho fetch (null) must leave it untouched.
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': 500,
      }),
      IN_WINDOW_NOW_MS,
    );
    const after = await env.DB.prepare(
      'SELECT cleared_at FROM id33_events WHERE event_id = ?',
    )
      .bind(eventId)
      .first();
    expect((after as any).cleared_at).toBeNull();
  });

  it('a successful empty result ([]) clears an existing active event', async () => {
    const eventId = 'id33-test-empty-path';
    const seedEvent = JSON.stringify([
      {
        ID: eventId,
        RoadwayName: 'ID-33',
        Description: 'Seeded active event',
        IsFullClosure: true,
        Latitude: 43.6,
        Longitude: -111.1,
      },
    ]);
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': seedEvent,
      }),
      IN_WINDOW_NOW_MS,
    );
    const before = await env.DB.prepare(
      'SELECT cleared_at FROM id33_events WHERE event_id = ?',
    )
      .bind(eventId)
      .first();
    expect((before as any).cleared_at).toBeNull();

    // An empty (but successful) Idaho result must clear it.
    await runPollCycle(
      env as any,
      fakeFetch({
        'RoadClosures.html': roadclosuresOpen,
        'SelectedRoute=WY22': routesresultsWy22Open,
        'Sensors.StationResults': sensorsTetonpass,
        'routes.googleapis.com': GOOGLE_ROUTES_STUB,
        '511.idaho.gov': '[]',
      }),
      IN_WINDOW_NOW_MS,
    );
    const after = await env.DB.prepare(
      'SELECT cleared_at FROM id33_events WHERE event_id = ?',
    )
      .bind(eventId)
      .first();
    expect((after as any).cleared_at).not.toBeNull();
  });
});
