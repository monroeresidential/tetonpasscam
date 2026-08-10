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
  },
  (table) => [
    primaryKey({
      columns: [table.routeId, table.weekdayClass, table.hour, table.season],
    }),
  ],
);

export const statusSnapshots = sqliteTable(
  'status_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    capturedAt: text('captured_at').notNull(),
    segment: text('segment').notNull().default('wilson-stateline'),
    status: text('status', { enum: ['open', 'restricted', 'closed', 'unknown'] }).notNull(),
    conditionText: text('condition_text'),
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
  // WYDOT's own "Last Report Time" from the Sensors.StationResults page
  // (WeatherReading.reportedAt), NOT re-derived from capturedAt (the
  // poller's own fetch time) -- see LH T2 finding 4's survey: the API used
  // to relabel capturedAt as reportedAt because this column didn't exist,
  // silently discarding the parser's own reading. Nullable because the
  // parser can fail to find/parse the timestamp text even when the numeric
  // readings themselves come through fine.
  reportedAt: text('reported_at'),
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
  (table) => [index('alerts_expires_status_idx').on(table.expiresAt, table.status)],
);

export const feedback = sqliteTable('feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at').notNull(),
  body: text('body').notNull(),
  email: text('email'),
  ipHash: text('ip_hash'),
});

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
  statusSnapshots,
  weatherSnapshots,
  id33Events,
  detourSnapshots,
  alerts,
  feedback,
  bans,
  cameraErrors,
  feedbackEmailCounter,
};
