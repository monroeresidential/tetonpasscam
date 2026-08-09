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
function freshUnknown(): StatusResult {
  return {
    status: 'unknown',
    conditionText: null,
    advisories: [],
    restrictions: [],
    wydotReportTime: null,
    source: 'primary',
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
