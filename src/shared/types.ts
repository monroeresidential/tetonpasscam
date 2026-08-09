import type { WeatherReading } from '../worker/poller/wydot-weather';

export type PassStatus = 'open' | 'restricted' | 'closed' | 'unknown';

/** Minimal placeholder shape for a publicly-visible driver-submitted alert.
 *  Task 10 owns the alerts table/API and will refine this (e.g. narrowing
 *  `type` to the `alerts` schema enum); this task only needs it typed so
 *  `ApiStatus.alerts` isn't `any[]`. */
export interface PublicAlert {
  id: number;
  type: string;
  note: string | null;
  direction: string | null;
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
  alerts: PublicAlert[]; // wired in Task 10
}
