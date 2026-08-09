import type { SeedRoute } from '../db/seed-routes';
import { denverHour } from '../tz';

export interface RouteTimeResult {
  durationSec: number;
  staticDurationSec: number;
  distanceM: number;
}

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.staticDuration,routes.distanceMeters';

/** Parses a Google Duration string like '1860s' into seconds. Returns null for
 *  anything that isn't a plain non-negative-number-then-'s' string, rather
 *  than NaN, so callers never have to guard against NaN downstream. */
function parseDurationSec(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return null;
  return Number(match[1]);
}

/** Fetches live drive time for one route via the Google Routes API
 *  computeRoutes endpoint. Never throws: any HTTP error, network failure,
 *  timeout, or malformed/missing response field resolves to null. */
export async function fetchRouteTime(
  apiKey: string,
  route: SeedRoute,
  fetcher: typeof fetch = fetch,
): Promise<RouteTimeResult | null> {
  try {
    const response = await fetcher(COMPUTE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: route.originLat, longitude: route.originLng } } },
        destination: {
          location: { latLng: { latitude: route.destLat, longitude: route.destLng } },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      routes?: Array<{ duration?: unknown; staticDuration?: unknown; distanceMeters?: unknown }>;
    };
    const first = data.routes?.[0];
    if (!first) return null;

    const durationSec = parseDurationSec(first.duration);
    const staticDurationSec = parseDurationSec(first.staticDuration);
    const distanceM = first.distanceMeters;
    if (durationSec === null || staticDurationSec === null || typeof distanceM !== 'number') {
      return null;
    }

    return { durationSec, staticDurationSec, distanceM };
  } catch {
    return null;
  }
}

/** True during the 05:00-23:00 America/Denver polling window (DST-aware via
 *  Intl), false outside it. */
export function inPollingWindow(nowUtcMs: number): boolean {
  const hour = denverHour(nowUtcMs);
  return hour >= 5 && hour < 23;
}
