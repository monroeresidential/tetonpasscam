// REAL COLUMN LAYOUT (captured 2026-08-09 from wyoroad.info RoadClosures.html):
//
// Each highway segment is one <tr>. Route and Town/Location cells use
// rowspan and are OMITTED from a segment's own <tr> block when a rowspan
// from an earlier row covers them (e.g. "Between Wilson and the Idaho State
// Line" shares its WY 22 / Jackson cells with the preceding
// "Between Jackson and Wilson" row via rowspan="2"). Columns are therefore
// identified by CSS class, never by position:
//
//   <td>                          segment text, e.g. "Between Wilson and the Idaho State Line"
//   <td class="*cond">            status/closure text, e.g. "Road Open" / "Road Closed due to ..."
//                                  (classes: closedcond, lowimpactcond, modimpactcond, highimpactcond, extendedcond)
//   <td class="*impact">          advisories, e.g. "None" / "Falling Rock"
//                                  (classes: noimpact, lowimpact, modimpact, highimpact, extendedimpact)
//   <td class="*restrict">        restrictions, e.g. weight-limit boilerplate, or "Chain Law Level 1"
//                                  (classes: noimpactrestrict, lowimpactrestrict, modimpactrestrict, highimpactrestrict, closedrestrict)
//   <td class="rpttime">          "Last Report Time", e.g. "Aug 9, 2026, 08:51 AM" (America/Denver, no explicit TZ)
//   <td class="cameras">          camera links (ignored)
//   <td class="sensors">          sensor links (ignored)
//
// There is no separate "Other Restrictions" column as the brief's sketch
// assumed; restrictions live in the single "*restrict" cell alongside
// always-present weight-limit text, so classification filters that cell's
// content against RESTRICTION_RX rather than treating any non-empty text
// as a restriction.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRoadClosures, denverToUtcIso } from '../../src/worker/poller/wydot-status';

const load = (f: string) => readFileSync(`test/fixtures/${f}`, 'utf8');

describe('parseRoadClosures', () => {
  it('parses open', () => {
    expect(parseRoadClosures(load('roadclosures-open.html')).status).toBe('open');
  });

  it('parses closed', () => {
    expect(parseRoadClosures(load('roadclosures-closed.html')).status).toBe('closed');
  });

  it('parses restricted', () => {
    const r = parseRoadClosures(load('roadclosures-restricted.html'));
    expect(r.status).toBe('restricted');
    expect(r.restrictions).toContain('Chain Law Level 1');
  });

  it('missing row ⇒ unknown, never open', () => {
    expect(parseRoadClosures(load('roadclosures-mangled.html')).status).toBe('unknown');
  });

  // REGRESSION (2026-08-18 incident): WYDOT does NOT render a closed segment
  // with the same six-cell shape as an open one. When a segment's condition
  // is elevated, the *cond cell is emitted with colspan="3" and the *impact
  // and *restrict cells are DROPPED ENTIRELY -- verified against real WYDOT
  // pages via the Wayback Machine, e.g.
  //   https://web.archive.org/web/20250216022646id_/https://www.wyoroad.info/highway/conditions/RoadClosures.html
  // where all 15 seasonally-closed segments read
  //   <td class="extendedcond" colspan="3">Road Closed Due To Seasonal Closure</td>
  //   <td class="rpttime">Feb 15, 2025, 06:59 PM</td>
  // with no *impact/*restrict cells between them, while all 96 open segments
  // keep the full <td class="noimpactcond" colspan="1"> + *impact + *restrict
  // shape. The pre-existing roadclosures-closed.html fixture was hand-edited
  // from an OPEN capture and so kept all four cells -- a shape WYDOT never
  // emits for a closure -- which is why this went undetected. Requiring all
  // four semantic cells made the parser structurally unable to EVER report a
  // closure from this page: every real closure was discarded as an
  // unrecognized shape and resolved to 'unknown'.
  it('parses a real-shaped closure row (cond cell colspan=3, no *impact/*restrict cells)', () => {
    const r = parseRoadClosures(load('roadclosures-closed-merged.html'));
    expect(r.status).toBe('closed');
    expect(r.conditionText).toBe('Road Closed Due To Crash');
    // The closure's own report time must survive: a CLOSED banner with no
    // "as of" timestamp is exactly what the incident produced.
    expect(r.wydotReportTime).not.toBeNull();
    // Those columns genuinely do not exist on a closure row.
    expect(r.advisories).toEqual([]);
    expect(r.restrictions).toEqual([]);
  });

  it('empty/garbage ⇒ unknown', () => {
    expect(parseRoadClosures('').status).toBe('unknown');
    expect(parseRoadClosures('<html><body>oops</body></html>').status).toBe('unknown');
  });

  it('valley segment (Between Jackson and Wilson) is NOT matched', () => {
    // The valley row (Between Jackson and Wilson) and the pass row (Between
    // Wilson and the Idaho State Line) both read "Road Open" in their cond
    // cell, so asserting only on conditionText would pass even if the parser
    // grabbed the wrong row. Use the free discriminator instead: only the
    // Wilson-Stateline row carries the standing "Falling Rock" advisory: the
    // valley row's advisory is "None".
    const r = parseRoadClosures(load('roadclosures-open.html'));
    expect(r.conditionText).not.toMatch(/Jackson and Wilson/i);
    expect(r.advisories).toContain('Falling Rock');
  });

  it('converts Last Report Time from America/Denver to UTC ISO', () => {
    const r = parseRoadClosures(load('roadclosures-open.html'));
    expect(r.wydotReportTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('a decoy row containing SEGMENT_TEXT before the real row does not override it', () => {
    // A minimal fragment that merely mentions the segment text and has a
    // cond cell, but is missing the advisory/restriction/report-time cells
    // every real data row has, must not be treated as authoritative --
    // otherwise an earlier decoy/duplicate could flip a real closure to
    // "open".
    const decoy = '<tr><td>Between Wilson and the Idaho State Line</td><td class="noimpactcond">Road Open</td></tr>\n';
    const real = load('roadclosures-closed.html');
    const r = parseRoadClosures(decoy + real);
    expect(r.status).toBe('closed');
  });

  it('unknown results never share array instances across calls', () => {
    const a = parseRoadClosures('');
    a.advisories.push('mutated');
    a.restrictions.push('mutated');
    const b = parseRoadClosures('<html><body>oops</body></html>');
    expect(b.advisories).toEqual([]);
    expect(b.restrictions).toEqual([]);
  });

  it('a cond cell asserting both "Road Open" and closure language is unrecognized ⇒ unknown, never closed or open', () => {
    const ambiguous = load('roadclosures-closed.html').replace(
      'Road Closed due to winter conditions',
      'Road Open<br />Closures expected 8pm',
    );
    const r = parseRoadClosures(ambiguous);
    expect(r.status).toBe('unknown');
  });
});

describe('denverToUtcIso', () => {
  it('converts a summer (MDT, UTC-6) timestamp correctly', () => {
    // Aug 9, 2026 08:51 AM MDT === 14:51 UTC
    expect(denverToUtcIso('Aug 9, 2026, 08:51 AM')).toBe('2026-08-09T14:51:00.000Z');
  });

  it('converts a winter (MST, UTC-7) timestamp correctly', () => {
    // Jan 9, 2026 08:51 AM MST === 15:51 UTC
    expect(denverToUtcIso('Jan 9, 2026, 08:51 AM')).toBe('2026-01-09T15:51:00.000Z');
  });

  it('returns null for unparseable input', () => {
    expect(denverToUtcIso('not a date')).toBeNull();
  });

  describe('DST transition days (2026: spring-forward Mar 8, fall-back Nov 1)', () => {
    it('a post-transition spring-forward wall-clock time converts using the new (MDT) offset', () => {
      // Clocks jump 2:00 AM MST -> 3:00 AM MDT, so 3:30 AM local is already
      // MDT (UTC-6): 03:30 + 6h = 09:30 UTC.
      expect(denverToUtcIso('Mar 8, 2026, 03:30 AM')).toBe('2026-03-08T09:30:00.000Z');
    });

    it('a later spring-forward-day wall-clock time also uses MDT', () => {
      // 08:00 AM MDT === 14:00 UTC.
      expect(denverToUtcIso('Mar 8, 2026, 08:00 AM')).toBe('2026-03-08T14:00:00.000Z');
    });

    it('a post-transition fall-back wall-clock time converts using the new (MST) offset', () => {
      // Clocks fall back 2:00 AM MDT -> 1:00 AM MST; by 3:00 AM local
      // (unambiguous, post-transition) Denver is back on MST (UTC-7):
      // 03:00 + 7h = 10:00 UTC.
      expect(denverToUtcIso('Nov 1, 2026, 03:00 AM')).toBe('2026-11-01T10:00:00.000Z');
    });
  });
});
