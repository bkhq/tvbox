CREATE TABLE `tvbox_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`sha256` text NOT NULL,
	`md5` text NOT NULL,
	`size` integer NOT NULL,
	`name` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_assets_source` ON `tvbox_assets` (`source_url`);--> statement-breakpoint
CREATE TABLE `tvbox_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`upstream_id` text,
	`upstream_key` text,
	`data` text NOT NULL,
	`upstream_data` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`locally_modified` integer DEFAULT false NOT NULL,
	`upstream_removed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`upstream_id`) REFERENCES `tvbox_upstreams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_entries_upstream_key` ON `tvbox_entries` (`upstream_id`,`kind`,`upstream_key`);--> statement-breakpoint
CREATE INDEX `idx_tvbox_entries_kind_sort` ON `tvbox_entries` (`kind`,`sort`);--> statement-breakpoint
CREATE TABLE `tvbox_globals` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`upstream_value` text,
	`locally_modified` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tvbox_publishes` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`counts` text NOT NULL,
	`trigger` text NOT NULL,
	`restored_from` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tvbox_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`hint` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tvbox_tokens_hash` ON `tvbox_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `tvbox_upstreams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`last_status` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
