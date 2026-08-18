// LIVE CONTRACT TEST -- hits wyoroad.info over the network. Deliberately NOT
// part of `npm test` / `test:worker` / `test:app`: it has its own config so a
// WYDOT outage, a flaky connection, or working on a plane can never fail the
// ordinary suite. Run it with `npm run test:contract`.
//
// This is the only test in the repo that can catch the failure mode behind
// the 2026-08-18 incident. Every other test checks our code against frozen
// fixtures, and fixtures keep passing while the live page drifts underneath
// them: WYDOT changed nothing that day, our parser simply believed something
// about their markup that was never true for closed rows. A committed capture
// can never report that.
//
// If this fails, WYDOT has changed the pages and the parsers are about to go
// (or have already gone) blind. Capture the page before touching anything --
// the failure output names the specific clause -- and see
// src/worker/poller/wydot-status.ts's isCompleteDataRow comment for how the
// shape was pinned down last time.

import { describe, expect, it } from 'vitest';

import { parseRoadClosures, parseRoutesResults } from '../../src/worker/poller/wydot-status';
import { checkRowShapes } from '../support/row-shape';

// Same descriptive User-Agent the poller sends (hard rule #7: WYDOT fetches
// identify themselves with a contact address).
const UA = 'tetonpasscam.com poller (drew@monroeresidential.com)';
const TIMEOUT_MS = 45_000;

const PRIMARY_URL = 'https://www.wyoroad.info/highway/conditions/RoadClosures.html';
const FALLBACK_URL = 'https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22';

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  });
  expect(res.status, `${url} returned HTTP ${res.status}`).toBe(200);
  return await res.text();
}

describe('live WYDOT page shape', () => {
  it(
    'RoadClosures.html still matches the shape contract',
    async () => {
      const report = checkRowShapes(await fetchPage(PRIMARY_URL));
      // Surfaced on every run, pass or fail: `mergedShapeRows: 0` means no
      // Wyoming road was closed at this moment, so the closed-row half of the
      // contract went unexercised. That is a normal summer result, but it must
      // be VISIBLE rather than read as "closed rows verified".
      console.log(
        `[contract] RoadClosures: ${report.openShapeRows} open-shape rows, ` +
          `${report.mergedShapeRows} merged/closed-shape rows, classes: ${report.condClasses.join(', ')}` +
          (report.mergedShapeRows === 0 ? ' -- NO closed rows present, merged-shape clause unexercised' : ''),
      );
      expect(report.violations).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'RoutesResults (WY22) still matches the shape contract',
    async () => {
      const report = checkRowShapes(await fetchPage(FALLBACK_URL));
      console.log(
        `[contract] RoutesResults: ${report.openShapeRows} open-shape rows, ` +
          `${report.mergedShapeRows} merged/closed-shape rows, classes: ${report.condClasses.join(', ')}`,
      );
      expect(report.violations).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'both pages still yield a DEFINITE status for the Teton Pass segment',
    async () => {
      // The shape contract above can hold while the specific row we depend on
      // moves or is renamed, so assert the end result too. 'unknown' from
      // either page is the exact symptom the incident presented with -- it is
      // never normal for both to be readable and our segment to be missing.
      const [primaryHtml, fallbackHtml] = await Promise.all([
        fetchPage(PRIMARY_URL),
        fetchPage(FALLBACK_URL),
      ]);
      const primary = parseRoadClosures(primaryHtml);
      const fallback = parseRoutesResults(fallbackHtml);
      console.log(
        `[contract] segment: primary=${primary.status} ("${primary.conditionText}") ` +
          `fallback=${fallback.status} ("${fallback.conditionText}")`,
      );
      expect(primary.status, 'primary page yielded no reading for the segment').not.toBe('unknown');
      expect(fallback.status, 'fallback page yielded no reading for the segment').not.toBe(
        'unknown',
      );
      // Report time is what a CLOSED banner needs in order to say "as of when",
      // and its absence was part of what made the incident banner unanchored.
      expect(primary.wydotReportTime).not.toBeNull();
    },
    TIMEOUT_MS,
  );
});
