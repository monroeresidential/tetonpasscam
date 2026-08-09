export interface Id33Event {
  eventId: string;
  description: string;
  isFullClosure: boolean;
}

const EVENT_URL = 'https://511.idaho.gov/api/v2/get/event';

// Box roughly ~25mi around Victor, ID (the Idaho-side approach to Teton Pass).
const LAT_MIN = 43.2;
const LAT_MAX = 44.0;
const LNG_MIN = -111.6;
const LNG_MAX = -110.9;

// Matches "33" as its own route-number token, optionally preceded by a route
// prefix like ID/SH/State Highway, e.g. "ID-33", "SH 33", "State Highway 33",
// or bare "33". Deliberately does NOT match a "33" that's part of a longer
// number, e.g. "US 133" or "SH-233", since \b alone would still match "133"
// (the digits 3,3 at the end of "133" are still bounded by \b at the string
// end) -- so a leading (?<!\d) is required to reject a preceding digit.
const ID33_ROUTE_RX = /(?<!\d)33\b/;

function inVictorBox(lat: number, lng: number): boolean {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX;
}

interface RawEvent {
  ID?: unknown;
  RoadwayName?: unknown;
  Description?: unknown;
  IsFullClosure?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
}

function parseEvent(raw: unknown): Id33Event | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as RawEvent;

  if (typeof e.ID !== 'string' && typeof e.ID !== 'number') return null;
  const eventId = String(e.ID);

  if (typeof e.RoadwayName !== 'string') return null;
  if (!ID33_ROUTE_RX.test(e.RoadwayName)) return null;

  if (typeof e.Latitude !== 'number' || typeof e.Longitude !== 'number') return null;
  if (!inVictorBox(e.Latitude, e.Longitude)) return null;

  if (typeof e.Description !== 'string') return null;
  if (typeof e.IsFullClosure !== 'boolean') return null;

  return { eventId, description: e.Description, isFullClosure: e.IsFullClosure };
}

/** Fetches current Idaho 511 events and filters to those on ID-33 near
 *  Victor, ID (the Idaho-side approach to Teton Pass). This is a secondary
 *  advisory signal only -- it never affects the pass status banner. Never
 *  throws: any HTTP error, network failure, timeout, or non-array payload
 *  resolves to null (distinct from an empty array, which means the fetch
 *  succeeded and found no matching events). Malformed individual entries are
 *  skipped rather than failing the whole result. */
export async function fetchId33Events(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<Id33Event[] | null> {
  try {
    // The Idaho 511 v2 API requires the key as a URL query parameter -- there
    // is no header-based auth option, so this is unavoidable. Never log this
    // URL anywhere.
    const url = `${EVENT_URL}?key=${encodeURIComponent(apiKey)}&format=json`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });

    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return null;

    const events: Id33Event[] = [];
    for (const raw of data) {
      const parsed = parseEvent(raw);
      if (parsed) events.push(parsed);
    }
    return events;
  } catch {
    return null;
  }
}
