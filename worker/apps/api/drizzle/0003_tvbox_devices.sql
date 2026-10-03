CREATE TABLE `tvbox_device_upstreams` (
	`device_id` text NOT NULL,
	`upstream_id` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `tvbox_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`upstream_id`) REFERENCES `tvbox_upstreams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_device_upstreams_pair` ON `tvbox_device_upstreams` (`device_id`,`upstream_id`);--> statement-breakpoint
CREATE INDEX `idx_tvbox_device_upstreams_upstream` ON `tvbox_device_upstreams` (`upstream_id`);--> statement-breakpoint
ALTER TABLE `tvbox_tokens` ADD `token` text;--> statement-breakpoint
ALTER TABLE `tvbox_tokens` ADD `all_upstreams` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tvbox_tokens` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tvbox_tokens` ADD `updated_at` text;