import { denverToUtcIso } from './wydot-status';

// REAL LAYOUT (captured 2026-08-09 from wyoroad.info
// Sensors.StationResults?SelectedStation=Teton+Pass):
//
// The whole page is one plain two-column `<table>`, no CSS classes at all
// (unlike the RoadClosures/RoutesResults *cond/*impact/*restrict scheme).
// Each sensor is one `<tr>` with exactly two `<td>` cells:
//
//   <td><font size="-1">LABEL</font></td>
//   <td><font size="-1">VALUE</font></td>
//
// e.g. `<td><font size="-1">Air temperature</font></td>` /
// `<td><font size="-1">70&#176F (21&#176C)</font></td>` -- the US unit
// always comes first, the metric conversion follows in parens, so taking
// the FIRST number in the value text is always the US-unit reading we want.
// Some rows carry a `bgcolor="#FFFFC6"` attribute on both `<td>`s (banding);
// irrelevant since cells are found by tag, not by attribute/position.
//
// Confirmed real labels (verbatim, sentence case, no colon): "Air
// temperature", "Relative humidity" (unused), "Dew point" (unused),
// "Visibility", "Surface temperature", "Wind gust", "Wind average", "Wind
// direction". There is exactly one row per label -- no duplicate/multiple
// sensor groups on this station's page (unlike the brief's defensive
// warning about e.g. two surface sensors) -- but LABEL_RX below is only
// ever matched against the FIRST row whose label matches, in case that
// warning is ever borne out on a future page reshape.
//
// GOTCHA: every value `<td>` is immediately preceded by a commented-out
// `<!--<td>...</td>-->` holding a stale/example reading for that same
// sensor (e.g. `<!--<td><font size="-1">25°F</font></td>-->` right before
// the real `70°F` cell) -- almost certainly a template leftover. A naive
// `<td>...</td>` scan that doesn't strip HTML comments first would see
// THREE td-shaped matches in that row (label, stale commented value, real
// value) and could easily grab the wrong one. Comments are stripped before
// any row/cell extraction below.
//
// Units: Visibility is reported directly in feet on this page (e.g. "6562
// ft (2000 m)"), so extractVisibilityFt is a passthrough for the live
// shape. It also detects a "mi"/"ft" unit token in the cell text and
// converts miles -> feet (x5280) if the cell ever reports miles instead --
// WeatherReading.visibilityFt is a typed contract (always feet), so a
// reshaped page reporting miles must not be allowed to silently store a
// value 5280x too small. Absent either unit token, the number is assumed
// to already be feet (matches every real capture), so behavior for the
// live page shape is unchanged.
//
// Separator rows: a bare `<tr><td>&nbsp;</td></tr>` (one cell, not two)
// appears between the humidity/visibility/surface group and the wind
// group -- skipped by the "exactly two cells" check below.
//
// The report timestamp ("Aug 9, 2026, 11:10 AM") sits as plain text before
// the table (between two `<br>` tags), not in any labeled cell. It is
// always wall-clock America/Denver with no explicit timezone, in the same
// format RoadClosures/RoutesResults's "Last Report Time" uses, so
// denverToUtcIso (imported from wydot-status, not duplicated here) applies
// unchanged.

export interface WeatherReading {
  airF: number | null;
  surfaceF: number | null;
  windAvgMph: number | null;
  windGustMph: number | null;
  windDir: string | null;
  visibilityFt: number | null;
  reportedAt: string | null; // ISO UTC
}

const NUMBER_RX = /-?\d+(?:\.\d+)?/;
const DATE_RX = /[A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)/i;
const ROW_RX = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RX = /<td[^>]*>([\s\S]*?)<\/td>/gi;

/** Strip HTML comments (which hide stale example values ahead of every real cell -- see layout comment above). */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Strip tags/entities and collapse whitespace down to a single trimmed string. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the first (US-unit) number out of a value cell's text, or null if there isn't one. */
function extractNumber(text: string): number | null {
  const m = NUMBER_RX.exec(text);
  return m ? parseFloat(m[0]) : null;
}

const FEET_UNIT_RX = /\bft\b/i;
const MILES_UNIT_RX = /\bmi\b/i;

/**
 * Extract the visibility number from its value cell's text and normalize it
 * to feet -- WeatherReading.visibilityFt's typed contract. The real page
 * always reports feet first (e.g. "6562 ft (2000 m)"), so this is a
 * passthrough for the live shape; if the cell text instead reports miles
 * (contains a standalone "mi" but not "ft"), the number is multiplied by
 * 5280 so a page reshape can't silently store a mile value as if it were
 * feet. Absent either unit token, the number is assumed to already be feet.
 */
function extractVisibilityFt(text: string): number | null {
  const value = extractNumber(text);
  if (value === null) return null;
  if (FEET_UNIT_RX.test(text)) return value;
  if (MILES_UNIT_RX.test(text)) return value * 5280;
  return value;
}

type NumericField = 'airF' | 'surfaceF' | 'windAvgMph' | 'windGustMph' | 'visibilityFt';

/** Match a stripped label cell's text to the WeatherReading field it reports, or null if unrecognized. */
function matchNumericLabel(label: string): NumericField | null {
  if (/^air temperature$/i.test(label)) return 'airF';
  if (/^surface temperature$/i.test(label)) return 'surfaceF';
  if (/^wind average$/i.test(label)) return 'windAvgMph';
  if (/^wind gust$/i.test(label)) return 'windGustMph';
  if (/^visibility$/i.test(label)) return 'visibilityFt';
  return null;
}

/**
 * Parse the WYDOT RWIS Sensors.StationResults page for Teton Pass. Never
 * throws. Returns null only if the page is unrecognizable (no known sensor
 * label found at all, e.g. empty/garbage html or a reshaped page) --
 * individual missing/blanked sensor VALUES instead come back as a null
 * field on an otherwise-populated reading, never fail the whole parse.
 */
export function parseSensorPage(html: string): WeatherReading | null {
  try {
    if (!html) return null;
    const stripped = stripComments(html);

    const reading: WeatherReading = {
      airF: null,
      surfaceF: null,
      windAvgMph: null,
      windGustMph: null,
      windDir: null,
      visibilityFt: null,
      reportedAt: null,
    };

    // Fields already resolved by an earlier row. Tracked separately from
    // "reading.<field> !== null" because a legitimately blank first match
    // (e.g. a blanked value cell) must still block a later duplicate-label
    // row from overwriting it -- first occurrence wins, deterministically,
    // even though this capture never actually has duplicate labels (see
    // layout comment above).
    const resolved = new Set<NumericField | 'windDir'>();

    for (const rowMatch of stripped.matchAll(ROW_RX)) {
      const cells = [...rowMatch[1].matchAll(CELL_RX)].map((c) => stripTags(c[1]));
      if (cells.length !== 2) continue; // not a label+value row (e.g. the bare &nbsp; separator row)

      const [label, valueText] = cells;
      if (!label) continue;

      if (/^wind direction$/i.test(label)) {
        if (resolved.has('windDir')) continue;
        resolved.add('windDir');
        reading.windDir = valueText.length > 0 ? valueText : null;
        continue;
      }

      const field = matchNumericLabel(label);
      if (!field) continue; // e.g. "Relative humidity" / "Dew point" -- not in WeatherReading
      if (resolved.has(field)) continue;
      resolved.add(field);
      reading[field] = field === 'visibilityFt' ? extractVisibilityFt(valueText) : extractNumber(valueText);
    }

    if (resolved.size === 0) return null;

    const dateMatch = DATE_RX.exec(stripTags(stripped));
    reading.reportedAt = dateMatch ? denverToUtcIso(dateMatch[0].trim()) : null;

    return reading;
  } catch {
    return null;
  }
}
