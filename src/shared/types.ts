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
  // ISO timestamp of when the WORKER produced this exact response (server
  // `Date.now()` at request time, not derived from any snapshot). Embedded
  // in the payload itself so staleness survives round-trips through storage
  // that would otherwise look "fresh" -- a Service-Worker- or
  // localStorage-cached copy of this response carries its original
  // `generatedAt` forever, even if something re-writes the bytes to a cache
  // at a later, more recent-looking time. See `useStatus.ts`'s
  // `isGeneratedAtStale` for the client-side guard this enables.
  generatedAt: string;
  // Datetime share code (`YYYYMMDD-HHmm`, America/Denver -- see
  // `src/worker/share-code.ts`) for the newest snapshot this response was
  // built from -- the share button builds `/s/{code}` from this. Null
  // whenever there's no snapshot to share (`pollerDead`, or no snapshot row
  // at all): a share card built from an already-dead-poller "current" view
  // would just be a stale, ancient row masquerading as "what I'm looking at
  // right now", so the share affordance is withheld entirely rather than
  // offered against a snapshot that's already past its own currency window.
  // This is independent of `/og/{code}`'s own validation -- a code shared
  // while `newest` was fresh remains servable by `/og`/`/s` forever after
  // (stale-share honesty: the card is a permanent historical snapshot by
  // design), this field only gates whether a NEW share link gets minted
  // from the CURRENT response.
  shareCode: string | null;
  lastConfirmed: { status: Exclude<PassStatus, 'unknown'>; at: string } | null; // newest non-unknown snapshot
  // The PRIMARY WYDOT page's (RoadClosures.html) "Closure Reason" cell --
  // open/closed wording such as "Road Open".
  conditionText: string | null;
  // The FALLBACK page's (WRR.RoutesResults) "Conditions" cell -- what the
  // road SURFACE is actually like: "Dry", "Wet", "Slick in spots", "Snow
  // packed". A different WYDOT field from `conditionText` above, not a
  // rewording of it. Display only; it never affects the OPEN/CLOSED banner.
  // Null when the fallback page failed, when its segment row was missing,
  // or whenever `pollerDead` -- a stale surface reading must not be shown
  // as a current observation.
  surfaceCondition: string | null;
  advisories: string[];
  restrictions: string[];
  wydotReportTime: string | null;
  weather: WeatherReading | null;
  // True when the newest weather_snapshots row is older than the weather
  // freshness window (see status.ts's WEATHER_STALE_MIN) -- `weather` above
  // is still returned (last-known is better than nothing for a stat strip),
  // but the frontend should visibly flag it as not current rather than
  // presenting it as a live reading.
  weatherStale: boolean;
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
    // True when this row is older than the live freshness window but still
    // within the max-age cap (see status.ts's TRAVEL_TIME_FRESHNESS_MIN /
    // TRAVEL_TIME_MAX_AGE_HOURS) -- the overnight-gap case: last night's
    // reading, shown muted and labeled "as of" rather than as current.
    stale: boolean;
  }[];
  id33Advisory: string | null;
  detours: { route: string; conditionText: string }[] | null; // only when closed
  alerts: PublicAlert[]; // active, unexpired community reports, newest first
  // Up to 5 upcoming America/Denver days from api.weather.gov, oldest
  // first, past dates excluded. An empty array is the honest
  // representation of "we have nothing" -- there is no placeholder day.
  //
  // HARD RULE: this NEVER influences `status`. A forecast is weather
  // adjacent to road state, not evidence about it, and its absence must
  // never degrade the banner. See api-status.test.ts's byte-identical
  // regression test.
  forecast: ForecastDay[];
  // Newest forecast_days.fetched_at older than FORECAST_STALE_HOURS. Same
  // contract as `weatherStale`: the data is still returned, the frontend
  // flags it rather than hiding it.
  forecastStale: boolean;
  // The next 12 hours from api.weather.gov, oldest first. Empty when
  // unavailable. Governed by `forecastStale` above -- one upstream, one
  // freshness signal.
  //
  // HARD RULE: like `forecast`, this NEVER influences `status`.
  hourly: ForecastHour[];
}

/** One (weekday-class, hour, season) typical bucket for a route, as returned
 *  by `GET /api/history` and rendered by the /history page's chart.
 *  `sampleCount`/`distinctDays` are nullable because rows written before
 *  migration 0005 have neither -- the client treats NULL as "no band". */
export interface HistoryTypical {
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
  sampleCount: number | null;
  distinctDays: number | null;
}

/** `GET /api/history`'s summary block, feeding the /history page's two
 *  summary tables. Every field is nullable, and absence is represented as
 *  `null` (never `0` or `[]`) -- see history.ts's helpers for why each one
 *  can legitimately be unknown rather than zero/empty. */
export interface HistorySummary {
  worstDays: { date: string; peakSec: number }[] | null;
  seasonMedians: { summer: number | null; winter: number | null } | null;
  closureDays: { winter: number | null } | null;
}

/** One `travel_times` row captured since Denver-local midnight "today". */
export interface HistoryToday {
  capturedAt: string;
  durationSec: number;
}

/** The `weather_typicals.metric` enum -- see `src/worker/db/schema.ts`. */
export type WeatherMetric = 'air_f' | 'surface_f' | 'dew_point_f' | 'humidity_pct';

/** One (metric, weekday-class, hour, season) typical bucket, as returned by
 *  `GET /api/weather-history`. Same nullable-confidence-fields shape as
 *  `HistoryTypical` and for the same reason: rows written before the
 *  confidence columns existed carry NULL there, not 0. */
export interface WeatherTypical {
  metric: WeatherMetric;
  weekdayClass: 'weekday' | 'weekend';
  season: 'winter' | 'summer';
  hour: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  sampleCount: number | null;
  distinctDays: number | null;
}

/** Response shape for `GET /api/weather-history`. Station-wide -- unlike
 *  `HistoryResult` this takes no route parameter, since the Teton Pass RWIS
 *  sensor reports one set of readings for the whole pass. */
export interface WeatherHistoryResult {
  typicals: WeatherTypical[];
  today: { capturedAt: string; airF: number | null; surfaceF: number | null }[];
}

/** The eight display categories a forecast day collapses to. Drives the
 *  severity tie-break in the poller's rollup and nothing else on the client
 *  -- the picture itself comes from `iconPath`. */
export type ForecastCategory =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'mixed'
  | 'thunderstorm'
  | 'fog';

/** One day of the summit forecast, as embedded in `ApiStatus.forecast`.
 *  Every reading is nullable and absence is `null` -- a day with no
 *  precipitation data renders an em-dash, never "0%". */
export interface ForecastDay {
  date: string; // America/Denver yyyy-mm-dd
  highF: number | null;
  lowF: number | null;
  category: ForecastCategory;
  // A path on OUR origin (`/api/wx-icon/...`), never an api.weather.gov URL
  // -- see api/wx-icon.ts. Null when the upstream icon was missing or
  // failed validation; the card still renders its text.
  iconPath: string | null;
  shortForecast: string | null;
  precipPct: number | null;
}

/** One upcoming hour of the summit forecast, as embedded in
 *  `ApiStatus.hourly`. Absence is `null`, never `0`. */
export interface ForecastHour {
  // The original ISO-with-offset string from NWS. Display only -- ordering
  // and filtering happen on the stored epoch key, never on this string,
  // which sorts wrongly across a DST change.
  startTime: string;
  tempF: number | null;
  category: ForecastCategory;
  // NWS's own daylight flag for this period, so a clear 10 PM hour can show
  // a moon rather than a sun.
  isDaytime: boolean;
  shortForecast: string | null;
  precipPct: number | null;
}

/** Response shape for `GET /api/history?route=<slug>`. `summary` is only
 *  computed when the request opts in with `?summary=1` (see
 *  `src/app/historyApi.ts`'s `getHistory`) -- it drives an expensive
 *  full-season `travel_times` scan that only the /history page's summary
 *  tables need, not the homepage's compact chart card. Null means "not
 *  requested", the same as it would for a route with no data at all. */
export interface HistoryResult {
  route: { slug: string; name: string };
  typicals: HistoryTypical[];
  today: HistoryToday[];
  summary: HistorySummary | null;
}
