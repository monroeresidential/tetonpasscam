CREATE TABLE `weather_typicals` (
	`metric` text NOT NULL,
	`weekday_class` text NOT NULL,
	`hour` integer NOT NULL,
	`season` text NOT NULL,
	`median` real,
	`p25` real,
	`p75` real,
	`sample_count` integer,
	`distinct_days` integer,
	PRIMARY KEY(`metric`, `weekday_class`, `hour`, `season`)
);
