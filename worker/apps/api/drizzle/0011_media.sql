CREATE TABLE `media_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kinds` text DEFAULT '["movie","series"]' NOT NULL,
	`filters` text DEFAULT '["genre","year","country"]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`overview` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` integer NOT NULL,
	`title_id` integer NOT NULL,
	`season_id` integer,
	`role` text NOT NULL,
	`character` text,
	`department` text,
	`job` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `media_people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `media_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_credits_title` ON `media_credits` (`title_id`,`season_id`);--> statement-breakpoint
CREATE INDEX `idx_media_credits_person` ON `media_credits` (`person_id`);--> statement-breakpoint
CREATE TABLE `media_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`episode_type` text DEFAULT 'standard' NOT NULL,
	`name` text,
	`overview` text,
	`air_date` text,
	`runtime` integer,
	`publish_state` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `media_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_episodes_number` ON `media_episodes` (`season_id`,`episode_number`);--> statement-breakpoint
CREATE TABLE `media_external_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_external_ids_ref` ON `media_external_ids` (`owner_type`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_media_external_ids_owner` ON `media_external_ids` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `media_genres` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tmdb_id` integer,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_genres_name` ON `media_genres` (`name`);--> statement-breakpoint
CREATE TABLE `media_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`asset_sha256` text,
	`asset_name` text,
	`locale` text,
	`width` integer,
	`height` integer,
	`is_primary` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_images_owner` ON `media_images` (`owner_type`,`owner_id`,`kind`);--> statement-breakpoint
CREATE TABLE `media_live_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`number` integer,
	`name` text NOT NULL,
	`tvg_id` text,
	`logo` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `media_live_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_live_channels_group` ON `media_live_channels` (`group_id`,`sort`);--> statement-breakpoint
CREATE TABLE `media_live_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_live_streams` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`url` text NOT NULL,
	`label` text,
	`user_agent` text,
	`referer` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `media_live_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_live_streams_channel` ON `media_live_streams` (`channel_id`,`sort`);--> statement-breakpoint
CREATE TABLE `media_people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`original_name` text,
	`gender` text,
	`biography` text,
	`birthday` text,
	`place_of_birth` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_people_name` ON `media_people` (`name`);--> statement-breakpoint
CREATE TABLE `media_row_items` (
	`row_id` text NOT NULL,
	`title_id` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`row_id`, `title_id`),
	FOREIGN KEY (`row_id`) REFERENCES `media_rows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`rule` text,
	`on_home` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`air_date` text,
	`end_date` text,
	`status` text DEFAULT 'airing' NOT NULL,
	`episode_total` integer,
	`update_schedule` text,
	`content_rating` text,
	`publish_state` text DEFAULT 'draft' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_seasons_number` ON `media_seasons` (`title_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `media_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` integer,
	`season_id` integer,
	`name` text NOT NULL,
	`quality` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `media_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_sources_title` ON `media_sources` (`title_id`);--> statement-breakpoint
CREATE INDEX `idx_media_sources_season` ON `media_sources` (`season_id`);--> statement-breakpoint
CREATE TABLE `media_streams` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`episode_id` text,
	`url` text NOT NULL,
	`format` text DEFAULT 'hls' NOT NULL,
	`resolution` text,
	`audio_locale` text,
	`user_agent` text,
	`referer` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `media_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_streams_source` ON `media_streams` (`source_id`,`episode_id`);--> statement-breakpoint
CREATE INDEX `idx_media_streams_episode` ON `media_streams` (`episode_id`);--> statement-breakpoint
CREATE TABLE `media_title_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` integer NOT NULL,
	`name` text NOT NULL,
	`locale` text,
	`kind` text DEFAULT 'alias' NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_title_aliases_title` ON `media_title_aliases` (`title_id`);--> statement-breakpoint
CREATE TABLE `media_title_genres` (
	`title_id` integer NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`title_id`, `genre_id`),
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `media_genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_title_genres_genre` ON `media_title_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `media_titles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`original_language` text,
	`origin_countries` text DEFAULT '[]' NOT NULL,
	`overview` text,
	`tagline` text,
	`release_date` text,
	`runtime` integer,
	`status` text DEFAULT 'released' NOT NULL,
	`status_locked` integer DEFAULT false NOT NULL,
	`content_rating` text,
	`is_adult` integer DEFAULT false NOT NULL,
	`vote_average` real,
	`vote_count` integer,
	`popularity` real DEFAULT 0 NOT NULL,
	`collection_id` text,
	`publish_state` text DEFAULT 'draft' NOT NULL,
	`origin` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `media_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_id`) REFERENCES `media_collections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_media_titles_category` ON `media_titles` (`category_id`,`publish_state`);--> statement-breakpoint
CREATE INDEX `idx_media_titles_collection` ON `media_titles` (`collection_id`);