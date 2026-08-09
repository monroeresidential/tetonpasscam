// REAL LAYOUTS CONFIRMED FROM LIVE CAPTURES (see test/fixtures/README.md for
// full detail and provenance):
//
// RoutesResults (WRR.RoutesResults?SelectedRoute=WY22): shares the exact
// *cond / *impact / *restrict / rpttime CSS-class column scheme with
// RoadClosures, but the segment cell is <td class="closurelocation"> (not
// classless), and the *cond cell holds a raw surface-condition report (e.g.
// "Dry") rather than a "Road Open" / "Road Closed due to ..." phrase. There
// is no "open" phrase to test for on this page, so closed/open comes down
// to the brief's rule: closed ⟺ the literal word "closed" appears in the
// *cond cell text (e.g. "CLOSED"); any other non-empty *cond text is this
// page's open evidence. Restrictions/advisories/report-time reuse the same
// classification as RoadClosures. The page also carries a District
// Comments table (class="region" / class="comments"), same shape as
// Statewide's.
//
// Statewide (MEDIA.Statewide): groups segments under
// <table class="mediagrid"><th class="XXXtitle">ADVISORY NAME</th> blocks,
// e.g. <th class="modtitle">Falling Rock</th> -- headings are named for the
// specific advisory/event, NOT literal "Open"/"Closed" text. The
// Wilson-Stateline row reads exactly `<td>Wilson</td><td>the Idaho State
// Line</td>`, confirming the brief's "match on Wilson + State Line"
// instruction. Heading class prefix maps to status: closedtitle -> closed;
// low/mod/high/extended-title -> restricted (an active advisory is not
// proof of closure OR of "open" -- restricted is the only value consistent
// with "no open without explicit open evidence"); no matching heading at
// all -> unknown (absence is not proof of open either).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRoutesResults, parseStatewide, diffAdvisories } from '../../src/worker/poller/wydot-status';

const load = (f: string) => readFileSync(`test/fixtures/${f}`, 'utf8');

describe('parseRoutesResults', () => {
  it('parses open and extracts a non-null District 3 / WY22 comment', () => {
    const r = parseRoutesResults(load('routesresults-wy22.html'));
    expect(r.status).toBe('open');
    expect(r.source).toBe('fallback');
    expect(r.district3Comments).not.toBeNull();
    expect(r.district3Comments).toMatch(/WY22|WY 22|Teton Pass/i);
  });

  it('does not match the valley segment (Between Jackson and Wilson)', () => {
    // Same free discriminator as the RoadClosures test suite: only the
    // Wilson-Stateline row carries the standing "Falling Rock" advisory.
    const r = parseRoutesResults(load('routesresults-wy22.html'));
    expect(r.advisories).toContain('Falling Rock');
  });

  it('parses a synthetic CLOSED Conditions cell as closed', () => {
    const r = parseRoutesResults(load('routesresults-wy22-closed.html'));
    expect(r.status).toBe('closed');
    expect(r.source).toBe('fallback');
  });

  it('the generic CLOSED-legend row near the page footer is not mistaken for the data row', () => {
    // routesresults-wy22.html (the OPEN fixture) itself contains the literal
    // text "CLOSED" in a legend row further down the page explaining impact
    // levels. That row has no closurelocation cell and must not confuse
    // classification of the live-open fixture.
    const r = parseRoutesResults(load('routesresults-wy22.html'));
    expect(r.status).toBe('open');
  });

  it('empty/garbage ⇒ unknown, never open, with null district3Comments', () => {
    expect(parseRoutesResults('').status).toBe('unknown');
    expect(parseRoutesResults('').district3Comments).toBeNull();
    expect(parseRoutesResults('<html><body>oops</body></html>').status).toBe('unknown');
  });

  it('a district comment that does not mention WY22/Teton Pass ⇒ null', () => {
    const html = `
      <table><tbody>
        <tr><td class="region">District 3 (Southwest)</td><td class="comments">I80: Bridge damage near Rawlins.</td></tr>
      </tbody></table>
      <tr>
        <td class="closurelocation">Between Wilson and the Idaho State Line</td>
        <td class="lowimpactcond">Dry</td>
        <td class="noimpact">None</td>
        <td class="noimpactrestrict">Weight restriction: 60000 lbs</td>
        <td class="rpttime">Aug 9, 2026, 08:51 AM</td>
      </tr>`;
    const r = parseRoutesResults(html);
    expect(r.district3Comments).toBeNull();
  });

  it('unknown results never share array instances across calls', () => {
    const a = parseRoutesResults('');
    a.advisories.push('mutated');
    a.restrictions.push('mutated');
    const b = parseRoutesResults('<html><body>oops</body></html>');
    expect(b.advisories).toEqual([]);
    expect(b.restrictions).toEqual([]);
  });
});

describe('parseStatewide', () => {
  it('reports restricted for the live fixture (segment listed only under the modtitle "Falling Rock" heading)', () => {
    expect(parseStatewide(load('statewide.html'))).toBe('restricted');
  });

  it('reports closed for the synthetic closedtitle fixture', () => {
    expect(parseStatewide(load('statewide-closed.html'))).toBe('closed');
  });

  it('segment absent from every heading ⇒ unknown, never open', () => {
    const html = `
      <table class="mediagrid"><thead>
        <tr><th class="modtitle" colspan="5">Some Other Advisory</th></tr>
      </thead><tbody>
        <tr><td class="nw">US 26/89</td><td class="nw">&nbsp;</td><td class="nw">Alpine Jct</td><td class="nw">Hoback Jct</td></tr>
      </tbody></table>`;
    expect(parseStatewide(html)).toBe('unknown');
  });

  it('empty/garbage ⇒ unknown', () => {
    expect(parseStatewide('')).toBe('unknown');
    expect(parseStatewide('<html><body>oops</body></html>')).toBe('unknown');
  });
});

describe('diffAdvisories', () => {
  it('an unchanged standing advisory (Falling Rock) is NOT an event', () => {
    expect(diffAdvisories(['Falling Rock'], ['Falling Rock'])).toEqual({ added: [], removed: [] });
  });

  it('a newly appearing advisory is added', () => {
    expect(diffAdvisories([], ['Falling Rock'])).toEqual({ added: ['Falling Rock'], removed: [] });
  });

  it('a disappearing advisory is removed', () => {
    expect(diffAdvisories(['Falling Rock', 'Chain Law Level 1'], ['Falling Rock'])).toEqual({
      added: [],
      removed: ['Chain Law Level 1'],
    });
  });

  it('handles simultaneous add and remove', () => {
    expect(diffAdvisories(['Falling Rock'], ['Falling Rock', 'Ice'])).toEqual({ added: ['Ice'], removed: [] });
  });

  it('both empty ⇒ both empty', () => {
    expect(diffAdvisories([], [])).toEqual({ added: [], removed: [] });
  });
});
