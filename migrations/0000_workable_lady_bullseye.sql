CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`type` text NOT NULL,
	`note` text,
	`direction` text,
	`device_hash` text NOT NULL,
	`ip_hash` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_expires_status_idx` ON `alerts` (`expires_at`,`status`);--> statement-breakpoint
CREATE TABLE `bans` (
	`device_hash` text PRIMARY KEY NOT NULL,
	`ip_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `detour_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text NOT NULL,
	`route` text,
	`condition_text` text
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`body` text NOT NULL,
	`email` text
);
--> statement-breakpoint
CREATE TABLE `id33_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text NOT NULL,
	`event_id` text,
	`description` text,
	`is_full_closure` integer,
	`cleared_at` text
);
--> statement-breakpoint
CREATE TABLE `route_typicals` (
	`route_id` integer NOT NULL,
	`weekday_class` text NOT NULL,
	`hour` integer NOT NULL,
	`season` text NOT NULL,
	`median_sec` integer,
	`p25_sec` integer,
	`p75_sec` integer,
	PRIMARY KEY(`route_id`, `weekday_class`, `hour`, `season`),
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`origin_lat` real NOT NULL,
	`origin_lng` real NOT NULL,
	`dest_lat` real NOT NULL,
	`dest_lng` real NOT NULL,
	`direction` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routes_slug_unique` ON `routes` (`slug`);--> statement-breakpoint
CREATE TABLE `status_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text NOT NULL,
	`segment` text DEFAULT 'wilson-stateline' NOT NULL,
	`status` text NOT NULL,
	`condition_text` text,
	`advisories` text,
	`restrictions` text,
	`wydot_report_time` text,
	`source` text
);
--> statement-breakpoint
CREATE INDEX `status_snapshots_captured_idx` ON `status_snapshots` (`captured_at`);--> statement-breakpoint
CREATE TABLE `travel_times` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`route_id` integer NOT NULL,
	`captured_at` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`static_duration_sec` integer,
	`distance_m` integer,
	`condition_snapshot` text,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `travel_times_route_captured_idx` ON `travel_times` (`route_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `weather_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text NOT NULL,
	`air_f` real,
	`surface_f` real,
	`wind_avg` real,
	`wind_gust` real,
	`wind_dir` text,
	`visibility_ft` real
);
