CREATE TABLE `forecast_hours` (
	`start_ms` integer PRIMARY KEY NOT NULL,
	`start_time` text NOT NULL,
	`temp_f` real,
	`category` text NOT NULL,
	`is_daytime` integer NOT NULL,
	`icon_url` text,
	`short_forecast` text,
	`precip_pct` integer,
	`fetched_at` text NOT NULL
);
