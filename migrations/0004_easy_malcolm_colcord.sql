CREATE INDEX `alerts_device_hash_created_idx` ON `alerts` (`device_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `alerts_ip_hash_created_idx` ON `alerts` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_ip_hash_created_idx` ON `feedback` (`ip_hash`,`created_at`);