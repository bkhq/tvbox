CREATE TABLE `media_title_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`title_id` integer NOT NULL,
	`locale` text NOT NULL,
	`title` text,
	`overview` text,
	`tagline` text,
	FOREIGN KEY (`title_id`) REFERENCES `media_titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_title_translations_locale` ON `media_title_translations` (`title_id`,`locale`);