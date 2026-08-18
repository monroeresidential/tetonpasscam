// WYDOT hands us the detour routes' conditions as one prose string per route,
// segment by segment:
//
//   "Between the Idaho State Line and Alpine Jct: Dry; Between Alpine Jct and
//    Hoback Jct: Dry; Between Hoback Jct and Jackson: Dry"
//
// Rendered verbatim that is ~9 lines on a phone, all of it saying "Dry", on
// the one screen where the driver is trying to find out how to get around a
// closed pass (screenshots, 2026-08-18). Collapsing it is not only shorter --
// it puts the EXCEPTION in front of the reader, which is the only part that
// changes a decision.
//
// The safety property under all of this: a condition that is not the norm must
// never be summarised away, and prose we cannot parse must never be silently
// dropped.

import { describe, expect, it } from 'vitest';

import { summarizeDetours } from '../../src/app/detourSummary';

const dryUs26 =
  'Between the Idaho State Line and Alpine Jct: Dry; Between Alpine Jct and Hoback Jct: Dry; Between Hoback Jct and Jackson: Dry';
const dryUs89 =
  'Between the Idaho State Line and Afton: Dry; Between Afton and Alpine Jct: Dry; Between Alpine Jct and Hoback Jct: Dry';

describe('summarizeDetours', () => {
  it('collapses to one line when every segment of every route reads the same', () => {
    expect(
      summarizeDetours([
        { route: 'US26', conditionText: dryUs26 },
        { route: 'US89', conditionText: dryUs89 },
      ]),
    ).toEqual(['Detour roads dry']);
  });

  it('keeps a non-clear uniform condition visible rather than hiding it', () => {
    expect(
      summarizeDetours([
        { route: 'US26', conditionText: 'Between A and B: Snow packed; Between B and C: Snow packed' },
        { route: 'US89', conditionText: 'Between D and E: Snow packed' },
      ]),
    ).toEqual(['Detour roads snow packed']);
  });

  it('reports each route separately when the routes differ from each other', () => {
    expect(
      summarizeDetours([
        { route: 'US26', conditionText: dryUs26 },
        { route: 'US89', conditionText: 'Between D and E: Wet; Between E and F: Wet' },
      ]),
    ).toEqual(['US-26 dry', 'US-89 wet']);
  });

  it('names the exceptional segment when one route is mostly uniform', () => {
    const summary = summarizeDetours([
      {
        route: 'US26',
        conditionText:
          'Between the Idaho State Line and Alpine Jct: Dry; Between Alpine Jct and Hoback Jct: Snow packed; Between Hoback Jct and Jackson: Dry',
      },
    ]);
    expect(summary).toEqual(['US-26 mostly dry · snow packed Alpine Jct→Hoback Jct']);
  });

  it('lists every segment when no condition holds a majority, rather than calling one "mostly"', () => {
    // 1 of 2 is not "mostly". Claiming it would understate the bad half.
    const summary = summarizeDetours([
      { route: 'US26', conditionText: 'Between A and B: Dry; Between B and C: Snow packed' },
    ]);
    expect(summary).toEqual(['US-26 dry A→B · snow packed B→C']);
  });

  it('falls back to the raw prose when the shape is unrecognised, never dropping it', () => {
    const raw = 'conditions currently unavailable for this route';
    expect(summarizeDetours([{ route: 'US26', conditionText: raw }])).toEqual([`US-26 ${raw}`]);
  });

  it('returns nothing for empty or absent input', () => {
    expect(summarizeDetours([])).toEqual([]);
    expect(summarizeDetours(null)).toEqual([]);
  });

  it('hyphenates route numbers to match the rest of the UI', () => {
    // The header above reads "US-26/US-89"; the raw feed says "US26".
    const summary = summarizeDetours([
      { route: 'US26', conditionText: 'Between A and B: Dry' },
      { route: 'US89', conditionText: 'Between C and D: Wet' },
    ]);
    expect(summary).toEqual(['US-26 dry', 'US-89 wet']);
  });

  it('drops the "Between" and a leading "the" from span names', () => {
    const summary = summarizeDetours([
      {
        route: 'US89',
        conditionText:
          'Between the Idaho State Line and Afton: Dry; Between Afton and Alpine Jct: Dry; Between Alpine Jct and Hoback Jct: Slick in spots',
      },
    ]);
    expect(summary).toEqual(['US-89 mostly dry · slick in spots Alpine Jct→Hoback Jct']);
  });
});
