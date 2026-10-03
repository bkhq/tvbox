CREATE TABLE `tvbox_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`device_ref` text,
	`app_device_id` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT '' NOT NULL,
	`abi` text DEFAULT '' NOT NULL,
	`version_code` integer DEFAULT 0 NOT NULL,
	`version_name` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`device_ref`) REFERENCES `tvbox_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_enrollments_code` ON `tvbox_enrollments` (`code`);--> statement-breakpoint
CREATE INDEX `idx_tvbox_enrollments_device` ON `tvbox_enrollments` (`device_ref`);