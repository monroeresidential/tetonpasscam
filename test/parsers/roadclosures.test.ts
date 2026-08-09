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

  it('empty/garbage ⇒ unknown', () => {
    expect(parseRoadClosures('').status).toBe('unknown');
    expect(parseRoadClosures('<html><body>oops</body></html>').status).toBe('unknown');
  });

  it('valley segment (Between Jackson and Wilson) is NOT matched', () => {
    // fixture contains both segments; assert conditionText comes from the Wilson-Stateline row
    const r = parseRoadClosures(load('roadclosures-open.html'));
    expect(r.conditionText).not.toMatch(/Jackson and Wilson/i);
  });

  it('converts Last Report Time from America/Denver to UTC ISO', () => {
    const r = parseRoadClosures(load('roadclosures-open.html'));
    expect(r.wydotReportTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
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
});
