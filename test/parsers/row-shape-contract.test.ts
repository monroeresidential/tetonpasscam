// The 2026-08-18 incident was not a logic bug in isolation -- it was our
// parser holding an assumption about WYDOT's markup that WYDOT does not
// honour. Fixture tests cannot catch that class of failure on their own: a
// fixture is a frozen snapshot, so it keeps passing while the live page
// drifts underneath it.
//
// So the assumption itself is written down here as an executable contract,
// checked across EVERY row of a page rather than only the Wilson-Stateline
// one. Run offline against real captures (below) it guards our own code;
// run against the live pages by test/contract/wydot-live.test.ts
// (`npm run test:contract`) the same function reports upstream drift.
//
// What the contract encodes, and why each clause exists:
//
//   1. cond + rpttime on every data row -- the invariant parseRoadClosures
//      and parseRoutesResults locate rows by. If WYDOT ever drops the report
//      time from a row shape, both parsers go blind on it.
//   2. Every *cond CLASS is one we know. parseRoutesResults classifies on
//      this class, so an unrecognised one resolves to 'unknown' silently.
//      A NEW severity class must fail loudly here instead.
//   3. The colspan <-> cell-set relation. This is the exact clause that
//      broke: colspan="1" rows carry *impact and *restrict cells, colspan>=2
//      rows have merged those columns away and carry neither.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { checkRowShapes } from '../support/row-shape';

const load = (f: string) => readFileSync(`test/fixtures/${f}`, 'utf8');

describe('checkRowShapes', () => {
  describe('real WYDOT captures satisfy the contract', () => {
    // A genuine capture (via the Wayback Machine) of a winter day on which 15
    // Wyoming segments were actually closed -- so unlike every other fixture
    // in this repo, the closed-row markup here is WYDOT's own output rather
    // than a hand-edit of an open row. See test/fixtures/README.md.
    it('the 2025-02-16 winter capture: 96 open rows and 15 genuinely closed ones', () => {
      const report = checkRowShapes(load('roadclosures-winter-2025-02-16.html'));
      expect(report.violations).toEqual([]);
      expect(report.openShapeRows).toBe(96);
      expect(report.mergedShapeRows).toBe(15);
    });

    it('the all-open live capture', () => {
      const report = checkRowShapes(load('roadclosures-open.html'));
      expect(report.violations).toEqual([]);
      expect(report.mergedShapeRows).toBe(0);
    });

    it('the fallback page, which shares the column scheme', () => {
      const report = checkRowShapes(load('routesresults-wy22.html'));
      expect(report.violations).toEqual([]);
    });

    it('our reconstructed merged-shape fixtures match what the real capture does', () => {
      const report = checkRowShapes(load('roadclosures-closed-merged.html'));
      expect(report.violations).toEqual([]);
      expect(report.mergedShapeRows).toBe(1);
    });
  });

  describe('detects the drift that would blind the parsers', () => {
    it('an unrecognised *cond class (a new WYDOT severity) is a violation', () => {
      const html = load('roadclosures-open.html').replace('noimpactcond', 'severeweathercond');
      const report = checkRowShapes(html);
      expect(report.violations.join(' ')).toMatch(/severeweathercond/);
    });

    it('a merged (colspan>=2) row that still carries an *impact cell is a violation', () => {
      // i.e. WYDOT starts merging columns differently than we assume.
      const html = load('roadclosures-closed-merged.html').replace(
        '<td class="closedcond" colspan="3">',
        '<td class="closedcond" colspan="3"></td><td class="modimpact">Falling Rock</td><td class="closedcond" colspan="3">',
      );
      expect(checkRowShapes(html).violations.length).toBeGreaterThan(0);
    });

    it('an unmerged (colspan=1) row missing its *restrict cell is a violation', () => {
      const html = load('roadclosures-open.html').replace(
        /<td class="noimpactrestrict"[\s\S]*?<\/td>/,
        '',
      );
      expect(checkRowShapes(html).violations.length).toBeGreaterThan(0);
    });

    it('a data row with no rpttime cell is a violation', () => {
      const html = load('roadclosures-open.html').replace(
        /<td class="rpttime">[\s\S]*?<\/td>/,
        '',
      );
      expect(checkRowShapes(html).violations.length).toBeGreaterThan(0);
    });

    it('a page with no data rows at all is a violation, not a vacuous pass', () => {
      // Guards the checker itself: a fetch that returns a WAF page, an error
      // page, or an empty body must not report "contract satisfied" merely
      // because it contains zero rows to violate it.
      const report = checkRowShapes('<html><body>Service Unavailable</body></html>');
      expect(report.violations.length).toBeGreaterThan(0);
    });
  });
});
