CREATE TABLE `camera_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`camera` text NOT NULL,
	`day` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `camera_errors_camera_day_idx` ON `camera_errors` (`camera`,`day`);