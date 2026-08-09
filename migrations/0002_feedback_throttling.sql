CREATE TABLE `feedback_email_counter` (
	`day` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `feedback` ADD `ip_hash` text;