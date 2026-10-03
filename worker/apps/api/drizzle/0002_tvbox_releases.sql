CREATE TABLE `tvbox_release_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`mode` text NOT NULL,
	`abi` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `tvbox_releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_release_assets_flavor` ON `tvbox_release_assets` (`release_id`,`mode`,`abi`);--> statement-breakpoint
CREATE TABLE `tvbox_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`version_code` integer NOT NULL,
	`version_name` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`withdrawn` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_releases_version` ON `tvbox_releases` (`version_code`);