CREATE TABLE `forecast_days` (
	`date` text PRIMARY KEY NOT NULL,
	`high_f` real,
	`low_f` real,
	`category` text NOT NULL,
	`icon_url` text,
	`short_forecast` text,
	`precip_pct` integer,
	`wind_gust_mph` real,
	`fetched_at` text NOT NULL
);
