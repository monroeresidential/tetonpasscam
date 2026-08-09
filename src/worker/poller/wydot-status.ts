import type { PassStatus } from '../../shared/types';

// REAL COLUMN LAYOUT (captured 2026-08-09 from wyoroad.info RoadClosures.html):
//
// Each highway segment is one <tr>. The Route and Town/Location cells use
// rowspan and are OMITTED from a segment's own <tr> block whenever a
// rowspan from an earlier row covers them -- e.g. the segment we care about,
// "Between Wilson and the Idaho State Line", shares its WY 22 / Jackson
// cells with the preceding "Between Jackson and Wilson" row via
// rowspan="2", so its own <tr> block contains no Route/Town cells at all.
// Columns MUST be identified by CSS class, never by position:
//
//   <td>                    segment text, e.g. "Between Wilson and the Idaho State Line"
//   <td class="*cond">      status/closure text, e.g. "Road Open" / "Road Closed due to ..."
//                            (closedcond, lowimpactcond, modimpactcond, highimpactcond, extendedcond)
//   <td class="*impact">    advisories, e.g. "None" / "Falling Rock"
//                            (noimpact, lowimpact, modimpact, highimpact, extendedimpact)
//   <td class="*restrict">  restrictions, e.g. always-present weight-limit boilerplate,
//                            or an active restriction like "Chain Law Level 1"
//                            (noimpactrestrict, lowimpactrestrict, modimpactrestrict,
//                             highimpactrestrict, closedrestrict)
//   <td class="rpttime">    "Last Report Time", e.g. "Aug 9, 2026, 08:51 AM" (America/Denver, no explicit TZ)
//   <td class="cameras">    camera links (ignored)
//   <td class="sensors">    sensor links (ignored)
//
// There is no separate "Other Restrictions" column as an earlier sketch of
// this parser assumed. Restrictions live in the single "*restrict" cell
// alongside always-present weight-limit text, so classification filters
// that cell's content against RESTRICTION_RX rather than treating any
// non-empty text as an active restriction.

export interface StatusResult {
  status: PassStatus;
  conditionText: string | null; // raw Conditions ("*cond" cell) text for the segment row
  advisories: string[]; // e.g. ['Falling Rock']
  restrictions: string[]; // e.g. ['Chain Law Level 1']
  wydotReportTime: string | null; // ISO UTC, converted from America/Denver
  source: 'primary' | 'fallback' | 'crosscheck';
}

export const SEGMENT_TEXT = 'Between Wilson and the Idaho State Line';

const CLOSURE_RX = /closed|closure/i;
const RESTRICTION_RX = /chain law|no unnecessary travel|no (light )?trailers|high profile/i;
const ADVISORY_RX = /^\s*none\s*$/i;

/** A fresh 'unknown' StatusResult. A function, not a shared constant, so callers
 *  can never mutate one call's arrays and have that leak into another's. */
function freshUnknown(source: StatusResult['source'] = 'primary'): StatusResult {
  return {
    status: 'unknown',
    conditionText: null,
    advisories: [],
    restrictions: [],
    wydotReportTime: null,
    source,
  };
}

/** Strip HTML tags/entities and collapse whitespace down to a single trimmed string. */
function strip(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

interface ClassifiedCell {
  className: string;
  text: string;
}

/** Extract every `<td class="...">...</td>` cell (with its class) from a row block, in order. */
function extractClassCells(rowBlock: string): ClassifiedCell[] {
  const cells: ClassifiedCell[] = [];
  const rx = /<td\s+class="([a-zA-Z]+)"[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(rowBlock)) !== null) {
    cells.push({ className: m[1], text: strip(m[2]) });
  }
  return cells;
}

/**
 * A genuine WYDOT data row for a segment carries all four semantic cells
 * (status, advisory, restrictions, report time) alongside the plain segment
 * <td> -- every one of the ~80 rows on the live page has this shape. A block
 * that merely contains SEGMENT_TEXT (e.g. a decoy/duplicate fragment
 * elsewhere on the page) but lacks this full shape is not a real data row
 * and must not be treated as authoritative for the segment's status.
 */
function isCompleteDataRow(cells: ClassifiedCell[]): boolean {
  const hasCond = cells.some((c) => /cond$/i.test(c.className));
  const hasAdvisory = cells.some((c) => /impact$/i.test(c.className) && !/restrict$/i.test(c.className));
  const hasRestrict = cells.some((c) => /restrict$/i.test(c.className));
  const hasRptTime = cells.some((c) => c.className === 'rpttime');
  return hasCond && hasAdvisory && hasRestrict && hasRptTime;
}

/**
 * Parse the WYDOT RoadClosures.html page and classify the Teton Pass
 * status. Never throws. Every failure path (missing row, empty page,
 * unrecognized shape) returns status 'unknown' -- there is no path that
 * defaults to 'open'.
 */
export function parseRoadClosures(html: string): StatusResult {
  try {
    if (!html) return freshUnknown();

    // Find the *first complete data row* whose block contains SEGMENT_TEXT.
    // Filtering on SEGMENT_TEXT alone is not enough: an earlier fragment
    // that merely mentions the segment (a decoy, a stray duplicate, a
    // caching artifact) but isn't a real table row would otherwise win by
    // being first, silently overriding the actual status.
    const candidates = html.split(/<tr[\s>]/i).filter((block) => block.includes(SEGMENT_TEXT));
    let row: string | undefined;
    let classCells: ClassifiedCell[] = [];
    for (const candidate of candidates) {
      const cells = extractClassCells(candidate);
      if (isCompleteDataRow(cells)) {
        row = candidate;
        classCells = cells;
        break;
      }
    }
    if (!row) return freshUnknown();

    const condCell = classCells.find((c) => /cond$/i.test(c.className));
    const impactCell = classCells.find((c) => /impact$/i.test(c.className) && !/restrict$/i.test(c.className));
    const restrictCell = classCells.find((c) => /restrict$/i.test(c.className));
    const rpttimeCell = classCells.find((c) => c.className === 'rpttime');

    const conditionText = condCell ? condCell.text : null;

    const restrictions = restrictCell && RESTRICTION_RX.test(restrictCell.text) ? [restrictCell.text] : [];

    const advisories = impactCell && impactCell.text && !ADVISORY_RX.test(impactCell.text) ? [impactCell.text] : [];

    // A cond cell is only unambiguous when it EITHER reads exactly "Road
    // Open" (allowing for other lines from a <br />-joined cell, e.g. a
    // camera/sensor note) OR contains closure language, but not both. A
    // cell that says "Road Open" on one line and something closure-like on
    // another (e.g. "Road Open<br />Closures expected 8pm") is an
    // unrecognized/ambiguous shape and must not be resolved either way.
    const lines = conditionText ? conditionText.split('\n').map((l) => l.trim()) : [];
    const hasRoadOpenLine = lines.some((l) => /^road open$/i.test(l));
    const hasClosureText = conditionText !== null && CLOSURE_RX.test(conditionText);

    let status: PassStatus = 'unknown';
    if (hasRoadOpenLine && !hasClosureText) {
      status = restrictions.length > 0 ? 'restricted' : 'open';
    } else if (hasClosureText && !hasRoadOpenLine) {
      status = 'closed';
    }

    const wydotReportTime = rpttimeCell ? denverToUtcIso(rpttimeCell.text) : null;

    return {
      status,
      conditionText,
      advisories,
      restrictions,
      wydotReportTime,
      source: 'primary',
    };
  } catch {
    return freshUnknown();
  }
}

// REAL LAYOUT: RoutesResults (captured 2026-08-09 from
// wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22):
//
// Shares the exact *cond / *impact / *restrict / rpttime CSS-class column
// scheme with RoadClosures (confirmed via this page's own CSS legend, e.g.
// td.closedcond, td.noimpactrestrict), so the same extractClassCells /
// isCompleteDataRow row-location technique applies unchanged. Two
// differences from RoadClosures:
//
//   1. The segment cell is `<td class="closurelocation">...</td>`, not
//      classless -- irrelevant to us since we still locate the row by
//      SEGMENT_TEXT match, not by that cell's class.
//   2. The `*cond` cell holds a raw surface-condition report (e.g. "Dry"),
//      never a "Road Open" phrase. There is no "open" phrase on this page
//      to assert on, so classification follows the brief's stated rule:
//      closed iff the word "closed" appears in the *cond text (e.g. a live
//      closure reads "CLOSED"); any other non-empty *cond text is this
//      page's equivalent open evidence. A cell naming both is unrecognized
//      -> unknown, same ambiguity philosophy as parseRoadClosures.
//
// This page also carries a "District Comments" table
// (<td class="region">District 3 (Southwest)</td><td class="comments">...)
// -- same shape reused by Statewide -- from which we pull the District 3
// comment when it mentions WY22/WY 22/Teton Pass.

const ROUTESRESULTS_CLOSED_RX = /\bclosed\b/i;

/**
 * Find the District 3 (Southwest) row in a District Comments table
 * (`<td class="region">...</td><td class="comments">...</td>`, the shape
 * shared by RoutesResults and Statewide) and return its comment text only
 * when it mentions the Teton Pass / WY22 segment; null otherwise, including
 * when no District 3 row exists at all. Never throws.
 */
function extractDistrict3Comments(html: string): string | null {
  try {
    const rowRx = /<td\s+class="region"[^>]*>([\s\S]*?)<\/td>\s*<td\s+class="comments"[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRx.exec(html)) !== null) {
      const region = strip(m[1]);
      if (!/district\s*3/i.test(region)) continue;
      const comment = strip(m[2]);
      return /WY\s?22|Teton Pass/i.test(comment) ? comment : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse the WYDOT RoutesResults?SelectedRoute=WY22 page (a fallback source
 * consulted when the primary RoadClosures parser fails or is ambiguous).
 * Never throws; every failure path returns 'unknown', never 'open'.
 */
export function parseRoutesResults(html: string): StatusResult & { district3Comments: string | null } {
  try {
    if (!html) return { ...freshUnknown('fallback'), district3Comments: null };

    // Same decoy-guard as parseRoadClosures: only a *complete* data row
    // (all four semantic cells present) for SEGMENT_TEXT is authoritative.
    // This page's own generic CLOSED-legend row (explaining impact levels,
    // near the page footer) has no closurelocation/cond/impact/restrict/
    // rpttime cells at all and is naturally excluded by this filter.
    const candidates = html.split(/<tr[\s>]/i).filter((block) => block.includes(SEGMENT_TEXT));
    let row: string | undefined;
    let classCells: ClassifiedCell[] = [];
    for (const candidate of candidates) {
      const cells = extractClassCells(candidate);
      if (isCompleteDataRow(cells)) {
        row = candidate;
        classCells = cells;
        break;
      }
    }
    const district3Comments = extractDistrict3Comments(html);
    if (!row) return { ...freshUnknown('fallback'), district3Comments };

    const condCell = classCells.find((c) => /cond$/i.test(c.className));
    const impactCell = classCells.find((c) => /impact$/i.test(c.className) && !/restrict$/i.test(c.className));
    const restrictCell = classCells.find((c) => /restrict$/i.test(c.className));
    const rpttimeCell = classCells.find((c) => c.className === 'rpttime');

    const conditionText = condCell ? condCell.text : null;

    const restrictions = restrictCell && RESTRICTION_RX.test(restrictCell.text) ? [restrictCell.text] : [];

    const advisories = impactCell && impactCell.text && !ADVISORY_RX.test(impactCell.text) ? [impactCell.text] : [];

    // Mirrors parseRoadClosures's mutual-exclusivity guard: a cell is only
    // unambiguous when it EITHER carries closure language ("closed") OR
    // some other non-empty condition report, but not both -- a cell naming
    // both (e.g. a stray "CLOSED<br />Dry" during a page reshape) is an
    // unrecognized shape and must resolve to unknown, never open or closed.
    const hasClosedWord = conditionText !== null && ROUTESRESULTS_CLOSED_RX.test(conditionText);
    const hasOtherConditionText = conditionText !== null && conditionText.replace(ROUTESRESULTS_CLOSED_RX, '').trim().length > 0;

    let status: PassStatus = 'unknown';
    if (hasClosedWord && !hasOtherConditionText) {
      status = 'closed';
    } else if (!hasClosedWord && conditionText !== null && conditionText.length > 0) {
      status = restrictions.length > 0 ? 'restricted' : 'open';
    }

    const wydotReportTime = rpttimeCell ? denverToUtcIso(rpttimeCell.text) : null;

    return {
      status,
      conditionText,
      advisories,
      restrictions,
      wydotReportTime,
      source: 'fallback',
      district3Comments,
    };
  } catch {
    return { ...freshUnknown('fallback'), district3Comments: null };
  }
}

// REAL LAYOUT: Statewide (captured 2026-08-09 from
// wyoroad.info/pls/Browse/MEDIA.Statewide):
//
// Segments are NOT grouped under literal "Open"/"Closed" headings as an
// earlier sketch of this parser assumed. Each group is one
// `<table class="mediagrid">` headed by `<th class="XXXtitle">NAME</th>`,
// e.g. `<th class="modtitle">Falling Rock</th>` -- the class prefix
// (low/mod/high/extended/closed) reuses the same impact-severity scheme
// confirmed on RoadClosures/RoutesResults's *cond/*impact classes, but the
// heading TEXT names the specific advisory/event ("Falling Rock"), not a
// generic status word. The Wilson-Stateline row in the live capture reads
// exactly `<td>Wilson</td><td>the Idaho State Line</td>`, confirming the
// brief's "match on Wilson + State Line" instruction.
//
// Mapping heading -> PassStatus:
//   - closedtitle             -> 'closed' (only unambiguous closure signal)
//   - low/mod/high/extended   -> 'restricted' (an active advisory is not
//                                 proof of closure, but also not proof of
//                                 "open" -- 'restricted' is the only value
//                                 consistent with "no open without explicit
//                                 open evidence")
//   - no heading match at all -> 'unknown' (absence is not proof of open;
//                                 this page only ever lists problem
//                                 segments, it has no explicit "open" list)
// If the segment is found under more than one heading, the most severe
// wins (closed > restricted).
//
// No live closedtitle example exists to capture (the pass is open), so
// that class name is inferred from the confirmed low/mod/high/extended
// naming convention rather than directly observed -- see fixtures/README.md.

const HEADING_TABLE_RX = /<table class="mediagrid"[^>]*>([\s\S]*?)<\/table>/gi;
const HEADING_TH_RX = /<th\s+class="([a-zA-Z]+)title"[^>]*>([\s\S]*?)<\/th>/i;

function headingStatus(className: string): PassStatus | null {
  if (className === 'closed') return 'closed';
  if (['low', 'mod', 'high', 'extended'].includes(className)) return 'restricted';
  return null;
}

/**
 * Parse the WYDOT Statewide Conditions for Media page (a cross-check source)
 * and report which condition-severity heading the Wilson-Stateline segment
 * sits under. Never throws; absence or any unrecognized shape -> 'unknown',
 * never 'open'.
 */
export function parseStatewide(html: string): PassStatus {
  try {
    if (!html) return 'unknown';

    let best: PassStatus | null = null;
    let m: RegExpExecArray | null;
    HEADING_TABLE_RX.lastIndex = 0;
    while ((m = HEADING_TABLE_RX.exec(html)) !== null) {
      const tableBlock = m[1];
      const headingMatch = HEADING_TH_RX.exec(tableBlock);
      if (!headingMatch) continue; // not a severity-heading table (e.g. District Comments, Impact Levels legend)

      const status = headingStatus(headingMatch[1].toLowerCase());
      if (!status) continue;

      // Match within a single <tr>, not anywhere in the table: other rows
      // in the same group can separately mention "Wilson" or "State Line"
      // (e.g. the unrelated "US 89 / the Idaho State Line / Afton" row),
      // and matching across the whole block could false-positive on a
      // segment that never actually shares its own row with both terms.
      const hasSegment = tableBlock
        .split(/<tr[\s>]/i)
        .some((rowBlock) => /wilson/i.test(rowBlock) && /state line/i.test(rowBlock));
      if (!hasSegment) continue;

      if (status === 'closed') return 'closed'; // most severe possible match, no need to keep scanning
      best = status;
    }
    return best ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Compare a previous and current advisory list and report which entries
 * appeared/disappeared. A plain set difference: an advisory present in both
 * lists (e.g. the standing "Falling Rock" advisory, active all summer 2026)
 * is naturally absent from both `added` and `removed` -- it is NOT an event.
 */
export function diffAdvisories(prev: string[], curr: string[]): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  return {
    added: curr.filter((a) => !prevSet.has(a)),
    removed: prev.filter((a) => !currSet.has(a)),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Convert a WYDOT "Last Report Time" string (e.g. "Aug 9, 2026, 08:51 AM"),
 * which is always wall-clock America/Denver with no explicit timezone or
 * offset, to a UTC ISO-8601 string. Returns null if the input can't be
 * parsed. DST-aware: derives the Denver UTC offset for the parsed date via
 * Intl.DateTimeFormat's shortOffset, rather than assuming a fixed -07:00.
 */
export function denverToUtcIso(dateText: string): string | null {
  try {
    const m = dateText
      .trim()
      .match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    const [, monStr, dayStr, yearStr, hourStr, minStr, ampm] = m;

    const monthIdx = MONTHS.indexOf(monStr.slice(0, 3).toLowerCase());
    if (monthIdx < 0) return null;

    let hour = parseInt(hourStr, 10) % 12;
    if (ampm.toUpperCase() === 'PM') hour += 12;
    const minute = parseInt(minStr, 10);
    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(day)) return null;

    // First guess: treat the Denver wall-clock time as if it were UTC, to
    // find which side of any DST boundary this date falls on. That guess
    // instant can itself land on the wrong side of the transition (its UTC
    // clock reading differs from the actual UTC instant by ~6-7 hours), so
    // re-derive the offset at the corrected instant and re-apply once more
    // if it changed -- this converges correctly across DST transition days,
    // both spring-forward (a skipped local hour) and fall-back (a repeated
    // one).
    const guessUtcMs = Date.UTC(year, monthIdx, day, hour, minute);
    const firstOffset = getDenverOffsetMinutes(new Date(guessUtcMs));
    let actualUtcMs = guessUtcMs - firstOffset * 60_000;
    const secondOffset = getDenverOffsetMinutes(new Date(actualUtcMs));
    if (secondOffset !== firstOffset) {
      actualUtcMs = guessUtcMs - secondOffset * 60_000;
    }
    const iso = new Date(actualUtcMs).toISOString();
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  } catch {
    return null;
  }
}

/** Get America/Denver's UTC offset in minutes (negative west of UTC) for the given instant. */
function getDenverOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    timeZoneName: 'shortOffset',
  });
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-7';
  const match = part.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -7;
  return hours * 60;
}
