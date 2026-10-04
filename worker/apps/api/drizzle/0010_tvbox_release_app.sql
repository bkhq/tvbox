DROP INDEX `idx_tvbox_releases_version`;--> statement-breakpoint
ALTER TABLE `tvbox_releases` ADD `app` text DEFAULT 'tvbox' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_releases_version` ON `tvbox_releases` (`app`,`version_code`);--> statement-breakpoint
ALTER TABLE `tvbox_release_assets` ADD `bundle_id` text;