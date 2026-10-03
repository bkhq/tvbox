ALTER TABLE `tvbox_entries` ADD `health_status` text;--> statement-breakpoint
ALTER TABLE `tvbox_entries` ADD `health_detail` text;--> statement-breakpoint
ALTER TABLE `tvbox_entries` ADD `health_checked_at` text;--> statement-breakpoint
ALTER TABLE `tvbox_entries` ADD `disabled_by_health` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tvbox_entries` ADD `health_exempt` integer DEFAULT false NOT NULL;