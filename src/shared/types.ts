import type { WeatherReading } from '../worker/poller/wydot-weather';

export type PassStatus = 'open' | 'restricted' | 'closed' | 'unknown';

/** Canonical camera ids for `POST /api/camera-error` and the frontend's
 *  camera strip (Task 15's frontend uses these exact ids) -- the three
 *  WY-22 cams reused from tetonflats.com's working WYDOT image URLs. This
 *  is the single allowlist: `postCameraError` rejects anything not in this
 *  set before it ever reaches the per-day throttle table, which caps the
 *  worst-case email-flood surface at exactly `CAMERA_IDS.length` emails per
 *  UTC day regardless of how many distinct bogus ids an attacker submits. */
export const CAMERA_IDS = ['valley', 'east', 'west'] as const;
export type CameraId = (typeof CAMERA_IDS)[number];

/** The `alerts.type` schema enum (see `src/worker/db/schema.ts`) -- the full
 *  set of community-report categories a driver can submit via
 *  `POST /api/alerts`. */
export type AlertType =
  | 'crash'
  | 'slideoff'
  | 'slick'
  | 'wildlife'
  | 'stopped'
  | 'closure'
  | 'other';

/** Public shape of a community-submitted alert, as returned by
 *  `GET /api/alerts` and embedded in `ApiStatus.alerts`. Deliberately omits
 *  `device_hash`/`ip_hash`/`status`/`expires_at` -- those are
 *  storage/anti-abuse internals, never exposed to clients. */
export interface PublicAlert {
  id: number;
  type: AlertType;
  note: string | null;
  direction: 'wb' | 'eb' | null;
  createdAt: string;
}

/** Response shape for `GET /api/status`, the single endpoint the Home screen
 *  reads. See Task 9 brief for the staleness/dead-poller degradation rules
 *  `isStale`/`pollerDead`/`lastConfirmed` encode. */
export interface ApiStatus {
  status: PassStatus;
  isStale: boolean; // wydotReportTime older than STALE_HOURS (12)
  pollerDead: boolean; // newest snapshot > 2h old ⇒ status forced 'unknown'
  lastConfirmed: { status: Exclude<PassStatus, 'unknown'>; at: string } | null; // newest non-unknown snapshot
  conditionText: string | null;
  advisories: string[];
  restrictions: string[];
  wydotReportTime: string | null;
  weather: WeatherReading | null;
  // One entry per route-direction that has at least one travel_times row.
  // A route with zero recorded travel times (e.g. the poller has never
  // successfully reached it) is OMITTED here, not included with a null/0
  // durationSec -- durationSec is a real, non-nullable reading, so there is
  // no valid placeholder value for "no data yet". In steady-state operation
  // this holds all 12 seeded route-directions; a shorter array only means
  // some routes have no travel-time history yet.
  travelTimes: {
    slug: string;
    name: string;
    durationSec: number;
    typicalSec: number | null;
    capturedAt: string;
  }[];
  id33Advisory: string | null;
  detours: { route: string; conditionText: string }[] | null; // only when closed
  alerts: PublicAlert[]; // active, unexpired community reports, newest first
}
