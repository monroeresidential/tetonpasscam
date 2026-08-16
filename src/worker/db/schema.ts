import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const routes = sqliteTable('routes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  originLat: real('origin_lat').notNull(),
  originLng: real('origin_lng').notNull(),
  destLat: real('dest_lat').notNull(),
  destLng: real('dest_lng').notNull(),
  direction: text('direction', { enum: ['eb', 'wb'] }).notNull(),
});

export const travelTimes = sqliteTable(
  'travel_times',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    routeId: integer('route_id')
      .notNull()
      .references(() => routes.id),
    capturedAt: text('captured_at').notNull(),
    durationSec: integer('duration_sec').notNull(),
    staticDurationSec: integer('static_duration_sec'),
    distanceM: integer('distance_m'),
    conditionSnapshot: text('condition_snapshot'),
  },
  (table) => [
    index('travel_times_route_captured_idx').on(table.routeId, table.capturedAt),
  ],
);

export const routeTypicals = sqliteTable(
  'route_typicals',
  {
    routeId: integer('route_id')
      .notNull()
      .references(() => routes.id),
    weekdayClass: text('weekday_class', { enum: ['weekday', 'weekend'] }).notNull(),
    hour: integer('hour').notNull(),
    season: text('season', { enum: ['winter', 'summer'] }).notNull(),
    medianSec: integer('median_sec'),
    p25Sec: integer('p25_sec'),
    p75Sec: integer('p75_sec'),
    // Confidence inputs for the /history band gate. Nullable because rows
    // written before migration 0005 have neither -- the client treats NULL
    // as "no band", so the pre-rebuild window degrades to median-only
    // rather than drawing a band it cannot justify. rebuildTypicals does a
    // full DELETE + rebuild nightly, so NULLs disappear after one run.
    sampleCount: integer('sample_count'),
    // Distinct America/Denver calendar days contributing to this bucket.
    // This -- not sampleCount -- is what the band gate keys on: 30 samples
    // at 8 AM is really 5 days x 6 polls, and within-hour spread is not the
    // day-to-day spread a "typical band" claims to show.
    distinctDays: integer('distinct_days'),
  },
  (table) => [
    primaryKey({
      columns: [table.routeId, table.weekdayClass, table.hour, table.season],
    }),
  ],
);

/**
 * Typical weather by (metric, weekday-class, hour, season), rebuilt nightly
 * from `weather_snapshots` exactly the way `route_typicals` is rebuilt from
 * `travel_times`, and gated by the same MIN_DISTINCT_DAYS_FOR_BAND rule.
 *
 * Deliberately ROWS per metric rather than COLUMNS per metric: weather is a
 * single station rather than twelve routes, so this tops out at ~96 rows per
 * metric, and adding a metric later becomes data instead of another
 * migration.
 */
export const weatherTypicals = sqliteTable(
  'weather_typicals',
  {
    metric: text('metric').notNull(),
    weekdayClass: text('weekday_class', { enum: ['weekday', 'weekend'] }).notNull(),
    hour: integer('hour').notNull(),
    season: text('season', { enum: ['winter', 'summer'] }).notNull(),
    median: real('median'),
    p25: real('p25'),
    p75: real('p75'),
    sampleCount: integer('sample_count'),
    distinctDays: integer('distinct_days'),
  },
  (table) => [
    primaryKey({ columns: [table.metric, table.weekdayClass, table.hour, table.season] }),
  ],
);

export const statusSnapshots = sqliteTable(
  'status_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    capturedAt: text('captured_at').notNull(),
    segment: text('segment').notNull().default('wilson-stateline'),
    status: text('status', { enum: ['open', 'restricted', 'closed', 'unknown'] }).notNull(),
    // The PRIMARY page's (RoadClosures.html) "Closure Reason" cell -- open/
    // closed wording like "Road Open", NOT a description of the road surface.
    conditionText: text('condition_text'),
    // The FALLBACK page's (WRR.RoutesResults) "Conditions" cell -- the actual
    // road-surface description: "Dry", "Wet", "Slick in spots", "Snow packed".
    // A separate column rather than a replacement because `condition_text` is
    // already consumed by /api/status and the SEO shell (seo-inject.ts), and
    // the two strings genuinely mean different things. Display only -- never
    // used to classify open/closed. Nullable: the fallback page can fail to
    // fetch or its segment row can go missing independently of the primary.
    surfaceConditionText: text('surface_condition_text'),
    advisories: text('advisories'), // JSON array string
    restrictions: text('restrictions'), // JSON array string
    wydotReportTime: text('wydot_report_time'),
    source: text('source'),
  },
  (table) => [index('status_snapshots_captured_idx').on(table.capturedAt)],
);

export const weatherSnapshots = sqliteTable('weather_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  capturedAt: text('captured_at').notNull(),
  airF: real('air_f'),
  surfaceF: real('surface_f'),
  windAvg: real('wind_avg'),
  windGust: real('wind_gust'),
  windDir: text('wind_dir'),
  visibilityFt: real('visibility_ft'),
  // Both are on the RWIS sensor page and were parsed-then-discarded until
  // now. Nullable like every other reading: an individual sensor can blank
  // out without failing the whole parse. Percent for humidity, Fahrenheit
  // for dew point -- same US-unit-only storage rule as air/surface temp.
  humidityPct: real('humidity_pct'),
  dewPointF: real('dew_point_f'),
  // WYDOT's own "Last Report Time" from the Sensors.StationResults page
  // (WeatherReading.reportedAt), NOT re-derived from capturedAt (the
  // poller's own fetch time) -- see LH T2 finding 4's survey: the API used
  // to relabel capturedAt as reportedAt because this column didn't exist,
  // silently discarding the parser's own reading. Nullable because the
  // parser can fail to find/parse the timestamp text even when the numeric
  // readings themselves come through fine.
  reportedAt: text('reported_at'),
});

/**
 * One row per America/Denver calendar day of the NWS forecast, upserted by
 * date each refresh so the same five-ish rows are revised rather than
 * accumulating. Past dates are left in place: they cost nothing and are the
 * raw material for any future forecast-vs-actual comparison.
 *
 * Every reading is nullable for the same reason the sensor columns are --
 * an individual field can be absent from the upstream payload without
 * invalidating the day. `category` is the exception: the rollup always
 * resolves one (falling back to 'cloudy'), so a row without it would mean a
 * bug, not missing data.
 */
export const forecastDays = sqliteTable('forecast_days', {
  date: text('date').primaryKey(), // America/Denver yyyy-mm-dd
  highF: real('high_f'),
  lowF: real('low_f'),
  category: text('category').notNull(),
  // The NWS icon URL as returned. Captured for its own sake and never read
  // by the API layer -- the client renders a local glyph tile instead (see
  // src/app/weatherGlyphs.ts). Retained rather than dropped: it costs
  // nothing and is the raw material if upstream artwork is ever wanted back.
  iconUrl: text('icon_url'),
  shortForecast: text('short_forecast'),
  precipPct: integer('precip_pct'),
  windGustMph: real('wind_gust_mph'),
  fetchedAt: text('fetched_at').notNull(),
});

/**
 * Hourly NWS periods backing the near-term forecast row. Fully REPLACED on
 * each refresh rather than upserted: unlike `forecast_days`, whose rows are a
 * stable set of dates worth revising in place, these are a sliding window
 * where yesterday's 3 PM is simply gone. Replace-all keeps the table from
 * growing a tail nobody reads and removes any need for a prune job.
 */
export const forecastHours = sqliteTable('forecast_hours', {
  // Epoch milliseconds, parsed at write. The primary key, and the ONLY column
  // ever compared or ordered on. The ISO string below cannot be used for
  // either: across a DST change it sorts wrongly -- 01:30-06:00 (07:30Z) is
  // earlier than 01:00-07:00 (08:00Z) but sorts after it. An integer instant
  // cannot be ambiguous that way.
  startMs: integer('start_ms').primaryKey(),
  // The original ISO-with-offset string, for display and debugging only.
  startTime: text('start_time').notNull(),
  tempF: real('temp_f'),
  category: text('category').notNull(),
  // Whether NWS considers this period daylight. Stored because the glyph
  // depends on it -- a clear 10 PM hour must not show a sun.
  isDaytime: integer('is_daytime', { mode: 'boolean' }).notNull(),
  iconUrl: text('icon_url'),
  shortForecast: text('short_forecast'),
  precipPct: integer('precip_pct'),
  fetchedAt: text('fetched_at').notNull(),
});

export const id33Events = sqliteTable('id33_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  capturedAt: text('captured_at').notNull(),
  eventId: text('event_id'),
  description: text('description'),
  isFullClosure: integer('is_full_closure', { mode: 'boolean' }),
  clearedAt: text('cleared_at'),
});

export const detourSnapshots = sqliteTable('detour_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  capturedAt: text('captured_at').notNull(),
  route: text('route'),
  conditionText: text('condition_text'),
});

export const alerts = sqliteTable(
  'alerts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    type: text('type', {
      enum: ['crash', 'slideoff', 'slick', 'wildlife', 'stopped', 'closure', 'other'],
    }).notNull(),
    note: text('note'),
    direction: text('direction'),
    deviceHash: text('device_hash').notNull(),
    ipHash: text('ip_hash'),
    status: text('status', { enum: ['active', 'expired', 'removed'] })
      .notNull()
      .default('active'),
  },
  (table) => [
    index('alerts_expires_status_idx').on(table.expiresAt, table.status),
    // Support the rate-limit conditional insert's two subqueries (see
    // postAlert in alerts.ts): `WHERE device_hash = ? AND created_at > ?`
    // and `WHERE ip_hash = ? AND created_at > ?`. Without these, both
    // subqueries fall back to a full table scan on every single POST.
    index('alerts_device_hash_created_idx').on(table.deviceHash, table.createdAt),
    index('alerts_ip_hash_created_idx').on(table.ipHash, table.createdAt),
  ],
);

export const feedback = sqliteTable(
  'feedback',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: text('created_at').notNull(),
    body: text('body').notNull(),
    email: text('email'),
    ipHash: text('ip_hash'),
  },
  (table) => [
    // Supports postFeedback's rate-limit conditional insert:
    // `WHERE ip_hash = ? AND created_at > ?`.
    index('feedback_ip_hash_created_idx').on(table.ipHash, table.createdAt),
  ],
);

export const bans = sqliteTable(
  'bans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceHash: text('device_hash'),
    ipHash: text('ip_hash'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('bans_device_hash_idx').on(table.deviceHash),
    index('bans_ip_hash_idx').on(table.ipHash),
  ],
);

// Throttles the `POST /api/camera-error` beacon (camera onerror handler) to
// one Resend email per camera per UTC calendar day. A UNIQUE(camera, day)
// index makes "has today's beacon for this camera already fired" a single
// INSERT OR IGNORE + changes-count check, with no separate SELECT needed and
// no cross-request in-memory state (Workers isolates are not guaranteed to
// persist between requests, so an in-memory Map would silently under- or
// over-throttle).
export const cameraErrors = sqliteTable(
  'camera_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    camera: text('camera').notNull(),
    day: text('day').notNull(), // UTC yyyy-mm-dd
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('camera_errors_camera_day_idx').on(table.camera, table.day)],
);

// Caps `POST /api/feedback` notification emails at `FEEDBACK_EMAIL_DAILY_CAP`
// (see feedback.ts) per UTC calendar day. One row per day, atomically
// incremented via `INSERT ... ON CONFLICT(day) DO UPDATE SET count = count +
// 1 RETURNING count` -- same "no cross-request in-memory state" reasoning as
// `cameraErrors` above, but this throttle counts *all* feedback posts toward
// one shared daily total rather than one row per (key, day), since the cap
// is global rather than per-camera.
export const feedbackEmailCounter = sqliteTable('feedback_email_counter', {
  day: text('day').primaryKey(), // UTC yyyy-mm-dd
  count: integer('count').notNull().default(0),
});

export const schema = {
  routes,
  travelTimes,
  routeTypicals,
  weatherTypicals,
  statusSnapshots,
  weatherSnapshots,
  forecastDays,
  forecastHours,
  id33Events,
  detourSnapshots,
  alerts,
  feedback,
  bans,
  cameraErrors,
  feedbackEmailCounter,
};
