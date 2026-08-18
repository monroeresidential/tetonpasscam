import type { ApiStatus } from '../shared/types';

/**
 * Turn the poller's per-route detour prose into the fewest lines that still
 * tell a driver everything that matters.
 *
 * WYDOT gives one string per route, segment by segment -- e.g. "Between the
 * Idaho State Line and Alpine Jct: Dry; Between Alpine Jct and Hoback Jct:
 * Dry; Between Hoback Jct and Jackson: Dry". Rendered verbatim that was ~9
 * phone lines of identical "Dry" on the CLOSED screen, where the driver is
 * trying to work out how to get around the pass.
 *
 * Two rules, in this order:
 *   1. If every segment of every route reads the same, say it once:
 *      "Detour roads dry".
 *   2. Otherwise say it per route, and within a route name only the segments
 *      that differ from the majority: "US-26 mostly dry · snow packed
 *      Alpine Jct→Hoback Jct".
 *
 * Two things it will not do, both deliberate:
 *   - It never summarises a non-normal condition away. Collapsing happens on
 *     whatever the condition IS, so a uniformly snow-packed detour reads
 *     "Detour roads snow packed", never just "Detour roads".
 *   - It never discards prose it cannot parse. An unrecognised shape is passed
 *     through verbatim behind the route name, because being unable to
 *     summarise WYDOT's wording is not a reason to withhold it.
 */

interface Segment {
  span: string;
  condition: string;
}

/** `US26` -> `US-26`, matching the hyphenated form the surrounding UI uses. */
function formatRoute(route: string): string {
  return route.replace(/^([A-Za-z]+)[\s-]?(\d+)$/, '$1-$2');
}

/** "Between the Idaho State Line and Afton" -> "Idaho State Line→Afton".
 *  Splits on the LAST " and ", since a place name may contain one. */
function shortSpan(span: string): string {
  const withoutBetween = span.replace(/^between\s+/i, '');
  const at = withoutBetween.toLowerCase().lastIndexOf(' and ');
  const [from, to] =
    at === -1
      ? [withoutBetween, null]
      : [withoutBetween.slice(0, at), withoutBetween.slice(at + ' and '.length)];
  const trim = (s: string) => s.trim().replace(/^the\s+/i, '');
  return to === null ? trim(from) : `${trim(from)}→${trim(to)}`;
}

/** Split one route's prose into segments, or null if it isn't the expected
 *  "<span>: <condition>; <span>: <condition>" shape. */
function parseSegments(text: string): Segment[] | null {
  const parts = text
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const segments: Segment[] = [];
  for (const part of parts) {
    // First colon, not last: spans don't contain colons, conditions might.
    const at = part.indexOf(':');
    if (at === -1) return null;
    const span = part.slice(0, at).trim();
    const condition = part.slice(at + 1).trim();
    if (!span || !condition) return null;
    segments.push({ span, condition: condition.toLowerCase() });
  }
  return segments;
}

/** The condition shared by a strict majority of segments, or null if none is.
 *  A bare plurality is not enough: describing 1-of-2 as "mostly dry" would
 *  understate the other half. */
function majorityCondition(segments: Segment[]): string | null {
  const counts = new Map<string, number>();
  for (const s of segments) counts.set(s.condition, (counts.get(s.condition) ?? 0) + 1);
  for (const [condition, count] of counts) {
    if (count * 2 > segments.length) return condition;
  }
  return null;
}

export function summarizeDetours(detours: ApiStatus['detours']): string[] {
  if (!detours || detours.length === 0) return [];

  const parsed = detours.map((d) => ({
    route: formatRoute(d.route),
    raw: d.conditionText,
    segments: parseSegments(d.conditionText),
  }));

  // Rule 1: everything, everywhere, reads the same.
  const allConditions = parsed.flatMap((p) => (p.segments ?? []).map((s) => s.condition));
  const everythingParsed = parsed.every((p) => p.segments !== null);
  const uniform = everythingParsed && allConditions.length > 0 && new Set(allConditions).size === 1;
  if (uniform) return [`Detour roads ${allConditions[0]}`];

  // Rule 2: per route.
  return parsed.map(({ route, raw, segments }) => {
    if (!segments) return `${route} ${raw}`;

    const conditions = new Set(segments.map((s) => s.condition));
    if (conditions.size === 1) return `${route} ${segments[0].condition}`;

    const majority = majorityCondition(segments);
    if (majority === null) {
      // No dominant condition -- spell out every segment rather than implying
      // one of them is the norm.
      return `${route} ${segments.map((s) => `${s.condition} ${shortSpan(s.span)}`).join(' · ')}`;
    }
    const exceptions = segments
      .filter((s) => s.condition !== majority)
      .map((s) => `${s.condition} ${shortSpan(s.span)}`);
    return `${route} mostly ${majority} · ${exceptions.join(' · ')}`;
  });
}
