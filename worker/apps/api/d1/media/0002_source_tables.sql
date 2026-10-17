-- The media library moves into D1: the source tables (`media_*`) join the
-- read model, and titles, seasons and people get random text ids instead
-- of integers. Nothing is carried over; the next publish refills the read
-- model from the (empty) source.

DROP TABLE rm_titles;
DROP TABLE rm_title_genres;
DROP TABLE rm_seasons;
DROP TABLE rm_playback;
DROP TABLE rm_people;
DROP TABLE rm_row_items;
DROP TABLE rm_search;
DROP TABLE rm_cms_items;

CREATE TABLE rm_titles (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category_id TEXT NOT NULL,
  year INTEGER,
  country TEXT,
  language TEXT,
  rating REAL NOT NULL DEFAULT 0,
  popularity REAL NOT NULL DEFAULT 0,
  release_key TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  manual_sort INTEGER NOT NULL DEFAULT 0,
  card_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_titles_cat_updated ON rm_titles (category_id, updated_at DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_popular ON rm_titles (category_id, popularity DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_release ON rm_titles (category_id, release_key DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_rating ON rm_titles (category_id, rating DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_manual ON rm_titles (category_id, manual_sort, id DESC);
CREATE INDEX idx_rm_titles_cat_year ON rm_titles (category_id, year);
CREATE INDEX idx_rm_titles_cat_country ON rm_titles (category_id, country);
CREATE INDEX idx_rm_titles_updated ON rm_titles (updated_at DESC, id DESC);

CREATE TABLE rm_title_genres (
  genre_id TEXT NOT NULL,
  title_id TEXT NOT NULL,
  PRIMARY KEY (genre_id, title_id)
) WITHOUT ROWID;
CREATE INDEX idx_rm_title_genres_title ON rm_title_genres (title_id);

CREATE TABLE rm_seasons (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_seasons_title ON rm_seasons (title_id, number);

-- One row per movie (title id) or episode (episode id) with something to play.
CREATE TABLE rm_playback (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL,
  season_id TEXT,
  episode_number INTEGER,
  json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_playback_season ON rm_playback (season_id, episode_number);
CREATE INDEX idx_rm_playback_title ON rm_playback (title_id);

CREATE TABLE rm_people (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE rm_row_items (
  row_id TEXT NOT NULL,
  sort INTEGER NOT NULL,
  title_id TEXT NOT NULL,
  PRIMARY KEY (row_id, sort)
) WITHOUT ROWID;

-- Titles and people by name. `type` says which, since ids carry no prefix.
CREATE VIRTUAL TABLE rm_search USING fts5(ref UNINDEXED, type UNINDEXED, hash UNINDEXED, text, tokenize = 'trigram');

-- The Apple CMS layer's items: a movie (title id) or one season of a series
-- (season id), with its `vod` as a list item and as a detail.
CREATE TABLE rm_cms_items (
  vod_id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL,
  season_id TEXT,
  type_id TEXT NOT NULL,
  year INTEGER,
  country TEXT,
  genres TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  group_order INTEGER NOT NULL DEFAULT 0,
  list_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_cms_type_updated ON rm_cms_items (type_id, updated_at DESC, vod_id);
CREATE INDEX idx_rm_cms_updated ON rm_cms_items (updated_at DESC, vod_id);
CREATE INDEX idx_rm_cms_title ON rm_cms_items (title_id, group_order);

-- Source tables, written by the admin API (modules/media/schema.ts is the
-- reference; regenerate from it when the schema changes).

CREATE TABLE `media_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kinds` text DEFAULT '["movie","series"]' NOT NULL,
	`filters` text DEFAULT '["genre","year","country"]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `media_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`overview` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `media_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`title_id` text NOT NULL,
	`season_id` text,
	`role` text NOT NULL,
	`character` text,
	`department` text,
	`job` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `media_people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `media_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_media_credits_title` ON `media_credits` (`title_id`,`season_id`);
CREATE INDEX `idx_media_credits_person` ON `media_credits` (`person_id`);
CREATE TABLE `media_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
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

CREATE UNIQUE INDEX `idx_media_episodes_number` ON `media_episodes` (`season_id`,`episode_number`);
CREATE TABLE `media_external_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL
);

CREATE UNIQUE INDEX `idx_media_external_ids_ref` ON `media_external_ids` (`owner_type`,`source`,`external_id`);
CREATE INDEX `idx_media_external_ids_owner` ON `media_external_ids` (`owner_type`,`owner_id`);
CREATE TABLE `media_genres` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tmdb_id` integer,
	`sort` integer DEFAULT 0 NOT NULL
);

CREATE UNIQUE INDEX `idx_media_genres_name` ON `media_genres` (`name`);
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

CREATE INDEX `idx_media_images_owner` ON `media_images` (`owner_type`,`owner_id`,`kind`);
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

CREATE INDEX `idx_media_live_channels_group` ON `media_live_channels` (`group_id`,`sort`);
CREATE TABLE `media_live_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);

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

CREATE INDEX `idx_media_live_streams_channel` ON `media_live_streams` (`channel_id`,`sort`);
CREATE TABLE `media_people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_name` text,
	`gender` text,
	`biography` text,
	`birthday` text,
	`place_of_birth` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE INDEX `idx_media_people_name` ON `media_people` (`name`);
CREATE TABLE `media_row_items` (
	`row_id` text NOT NULL,
	`title_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`row_id`, `title_id`),
	FOREIGN KEY (`row_id`) REFERENCES `media_rows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE `media_seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
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

CREATE UNIQUE INDEX `idx_media_seasons_number` ON `media_seasons` (`title_id`,`season_number`);
CREATE TABLE `media_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text,
	`season_id` text,
	`name` text NOT NULL,
	`quality` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `media_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_media_sources_title` ON `media_sources` (`title_id`);
CREATE INDEX `idx_media_sources_season` ON `media_sources` (`season_id`);
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

CREATE INDEX `idx_media_streams_source` ON `media_streams` (`source_id`,`episode_id`);
CREATE INDEX `idx_media_streams_episode` ON `media_streams` (`episode_id`);
CREATE TABLE `media_title_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`name` text NOT NULL,
	`locale` text,
	`kind` text DEFAULT 'alias' NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_media_title_aliases_title` ON `media_title_aliases` (`title_id`);
CREATE TABLE `media_title_genres` (
	`title_id` text NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`title_id`, `genre_id`),
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `media_genres`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_media_title_genres_genre` ON `media_title_genres` (`genre_id`);
CREATE TABLE `media_title_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text,
	`overview` text,
	`tagline` text,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_media_title_translations_locale` ON `media_title_translations` (`title_id`,`locale`);
CREATE TABLE `media_titles` (
	`id` text PRIMARY KEY NOT NULL,
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

CREATE INDEX `idx_media_titles_category` ON `media_titles` (`category_id`,`publish_state`);
CREATE INDEX `idx_media_titles_collection` ON `media_titles` (`collection_id`);
