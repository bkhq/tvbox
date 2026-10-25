import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// The media library's source data (docs/plan/media-library.md, part 1).
// Admins edit these rows and the Worker serves them to clients directly;
// publishing only marks which titles, seasons and episodes are live
// (`media_published`). They live in D1 (`d1/media/`), not in the Durable
// Object. Ids that clients see — titles,
// seasons, people — are random 12-character strings (`mediaId`) so the
// catalogue cannot be enumerated; the rest are ULIDs. Images and external ids
// hang off several owner types and so carry no foreign key: the owner's
// delete removes them.

const now = () => new Date().toISOString();
const createdAt = () => text("created_at").notNull().$defaultFn(now);
const updatedAt = () => text("updated_at").notNull().$defaultFn(now);

export const TITLE_KINDS = ["movie", "series"] as const;
export const TITLE_STATUSES = [
  "upcoming",
  "released",
  "returning",
  "ended",
  "canceled",
] as const;
export const SEASON_STATUSES = ["upcoming", "airing", "ended"] as const;
export const EPISODE_TYPES = [
  "standard",
  "premiere",
  "finale",
  "special",
] as const;
export const PUBLISH_STATES = ["draft", "published", "hidden"] as const;
export const EPISODE_PUBLISH_STATES = ["draft", "published"] as const;
export const IMAGE_OWNER_TYPES = [
  "title",
  "season",
  "episode",
  "person",
  "collection",
] as const;
export const IMAGE_KINDS = [
  "poster",
  "backdrop",
  "logo",
  "still",
  "profile",
] as const;
export const EXTERNAL_OWNER_TYPES = ["title", "season", "episode", "person"] as const;
export const EXTERNAL_SOURCES = ["tmdb", "imdb", "tvdb", "douban"] as const;
export const CREDIT_ROLES = ["cast", "crew"] as const;
export const STREAM_FORMATS = ["hls", "mp4", "dash"] as const;
export const ROW_KINDS = ["manual", "rule"] as const;

// ─── Taxonomy ───

// The browse axis (movies, series, anime, …): every title is in exactly one.
export const mediaCategories = sqliteTable("media_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // JSON array of the title kinds the category accepts.
  kinds: text("kinds").notNull().default("[\"movie\",\"series\"]"),
  // JSON array of the facets offered in this category, in order.
  filters: text("filters").notNull().default("[\"genre\",\"year\",\"country\"]"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mediaGenres = sqliteTable("media_genres", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tmdbId: integer("tmdb_id"),
  sort: integer("sort").notNull().default(0),
}, t => [
  uniqueIndex("idx_media_genres_name").on(t.name),
]);

export const mediaCollections = sqliteTable("media_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  overview: text("overview"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── Catalog ───

export const mediaTitles = sqliteTable("media_titles", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: TITLE_KINDS }).notNull(),
  categoryId: text("category_id").notNull().references(() => mediaCategories.id),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  originalLanguage: text("original_language"),
  // JSON array of ISO 3166-1 codes; the first is the main one.
  originCountries: text("origin_countries").notNull().default("[]"),
  overview: text("overview"),
  tagline: text("tagline"),
  releaseDate: text("release_date"),
  runtime: integer("runtime"),
  status: text("status", { enum: TITLE_STATUSES }).notNull().default("released"),
  // Series only: a status set by hand wins over the one derived from seasons.
  statusLocked: integer("status_locked", { mode: "boolean" }).notNull().default(false),
  contentRating: text("content_rating"),
  isAdult: integer("is_adult", { mode: "boolean" }).notNull().default(false),
  voteAverage: real("vote_average"),
  voteCount: integer("vote_count"),
  popularity: real("popularity").notNull().default(0),
  collectionId: text("collection_id").references(() => mediaCollections.id, { onDelete: "set null" }),
  publishState: text("publish_state", { enum: PUBLISH_STATES }).notNull().default("draft"),
  origin: text("origin"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index("idx_media_titles_category").on(t.categoryId, t.publishState),
  index("idx_media_titles_collection").on(t.collectionId),
]);

// Other names a title is found by: aliases and translations.
export const mediaTitleAliases = sqliteTable("media_title_aliases", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  locale: text("locale"),
  kind: text("kind", {
    enum: ["alias", "translation"],
  }).notNull().default("alias"),
}, t => [
  index("idx_media_title_aliases_title").on(t.titleId),
]);

// Per-locale title, overview and tagline; the columns on `media_titles` are
// the display values (the first locale that has them). One row per locale,
// so a new language is a new row, not a new column.
export const mediaTitleTranslations = sqliteTable("media_title_translations", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  title: text("title"),
  overview: text("overview"),
  tagline: text("tagline"),
}, t => [
  uniqueIndex("idx_media_title_translations_locale").on(t.titleId, t.locale),
]);

export const mediaTitleGenres = sqliteTable("media_title_genres", {
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  genreId: text("genre_id").notNull().references(() => mediaGenres.id, { onDelete: "cascade" }),
}, t => [
  primaryKey({
    columns: [t.titleId, t.genreId],
  }),
  index("idx_media_title_genres_genre").on(t.genreId),
]);

// Every episode of a series belongs to a season; a one-season series has a
// season 1. Season 0 holds specials.
export const mediaSeasons = sqliteTable("media_seasons", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: text("name"),
  overview: text("overview"),
  airDate: text("air_date"),
  endDate: text("end_date"),
  status: text("status", { enum: SEASON_STATUSES }).notNull().default("airing"),
  episodeTotal: integer("episode_total"),
  updateSchedule: text("update_schedule"),
  contentRating: text("content_rating"),
  publishState: text("publish_state", { enum: PUBLISH_STATES }).notNull().default("draft"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex("idx_media_seasons_number").on(t.titleId, t.seasonNumber),
]);

export const mediaEpisodes = sqliteTable("media_episodes", {
  id: text("id").primaryKey(),
  seasonId: text("season_id").notNull().references(() => mediaSeasons.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  episodeType: text("episode_type", { enum: EPISODE_TYPES }).notNull().default("standard"),
  name: text("name"),
  overview: text("overview"),
  airDate: text("air_date"),
  runtime: integer("runtime"),
  publishState: text("publish_state", { enum: EPISODE_PUBLISH_STATES }).notNull().default("published"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  uniqueIndex("idx_media_episodes_number").on(t.seasonId, t.episodeNumber),
]);

// ─── People ───

export const mediaPeople = sqliteTable("media_people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  originalName: text("original_name"),
  gender: text("gender", {
    enum: ["female", "male", "other"],
  }),
  biography: text("biography"),
  birthday: text("birthday"),
  placeOfBirth: text("place_of_birth"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index("idx_media_people_name").on(t.name),
]);

// `seasonId` null: the credit applies to every season. A season with credits
// of its own uses those instead.
export const mediaCredits = sqliteTable("media_credits", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => mediaPeople.id, { onDelete: "cascade" }),
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  seasonId: text("season_id").references(() => mediaSeasons.id, { onDelete: "cascade" }),
  role: text("role", { enum: CREDIT_ROLES }).notNull(),
  character: text("character"),
  department: text("department"),
  job: text("job"),
  sort: integer("sort").notNull().default(0),
}, t => [
  index("idx_media_credits_title").on(t.titleId, t.seasonId),
  index("idx_media_credits_person").on(t.personId),
]);

// ─── Artwork and external ids ───

// Either `url` (external) or `assetSha256` (uploaded, content-addressed).
export const mediaImages = sqliteTable("media_images", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: IMAGE_OWNER_TYPES }).notNull(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind", { enum: IMAGE_KINDS }).notNull(),
  url: text("url"),
  assetSha256: text("asset_sha256"),
  assetName: text("asset_name"),
  locale: text("locale"),
  width: integer("width"),
  height: integer("height"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, t => [
  index("idx_media_images_owner").on(t.ownerType, t.ownerId, t.kind),
]);

export const mediaExternalIds = sqliteTable("media_external_ids", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: EXTERNAL_OWNER_TYPES }).notNull(),
  ownerId: text("owner_id").notNull(),
  source: text("source", { enum: EXTERNAL_SOURCES }).notNull(),
  externalId: text("external_id").notNull(),
}, t => [
  uniqueIndex("idx_media_external_ids_ref").on(t.ownerType, t.source, t.externalId),
  index("idx_media_external_ids_owner").on(t.ownerType, t.ownerId),
]);

// ─── Playables ───

// A line (自建, 4K, …): on the title for a movie, on a season for a series.
export const mediaSources = sqliteTable("media_sources", {
  id: text("id").primaryKey(),
  titleId: text("title_id").references(() => mediaTitles.id, { onDelete: "cascade" }),
  seasonId: text("season_id").references(() => mediaSeasons.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quality: text("quality"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  index("idx_media_sources_title").on(t.titleId),
  index("idx_media_sources_season").on(t.seasonId),
]);

// One playable URL: the movie itself (no episode) or one episode.
export const mediaStreams = sqliteTable("media_streams", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => mediaSources.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => mediaEpisodes.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  format: text("format", { enum: STREAM_FORMATS }).notNull().default("hls"),
  resolution: text("resolution"),
  audioLocale: text("audio_locale"),
  userAgent: text("user_agent"),
  referer: text("referer"),
  sort: integer("sort").notNull().default(0),
}, t => [
  index("idx_media_streams_source").on(t.sourceId, t.episodeId),
  index("idx_media_streams_episode").on(t.episodeId),
]);

// ─── Home ───

// A home row: a hand-picked list, or a rule (`{"category", "genre", "sort"}`)
// expanded when served.
export const mediaRows = sqliteTable("media_rows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ROW_KINDS }).notNull().default("manual"),
  rule: text("rule"),
  onHome: integer("on_home", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mediaRowItems = sqliteTable("media_row_items", {
  rowId: text("row_id").notNull().references(() => mediaRows.id, { onDelete: "cascade" }),
  titleId: text("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  sort: integer("sort").notNull().default(0),
}, t => [
  primaryKey({
    columns: [t.rowId, t.titleId],
  }),
]);

// What devices see: the ids the last publish marked live.
export const mediaPublished = sqliteTable("media_published", {
  id: text("id").primaryKey(),
  kind: text("kind", {
    enum: ["title", "season", "episode"],
  }).notNull(),
}, t => [
  index("idx_media_published_kind").on(t.kind),
]);

// Key/value settings of the library: `hero_title_ids`, `live_epg_urls`,
// `published_generation`, …
export const mediaSettings = sqliteTable("media_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

// ─── Live ───

export const mediaLiveGroups = sqliteTable("media_live_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const mediaLiveChannels = sqliteTable("media_live_channels", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => mediaLiveGroups.id, { onDelete: "cascade" }),
  number: integer("number"),
  name: text("name").notNull(),
  tvgId: text("tvg_id"),
  logo: text("logo"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, t => [
  index("idx_media_live_channels_group").on(t.groupId, t.sort),
]);

export const mediaLiveStreams = sqliteTable("media_live_streams", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => mediaLiveChannels.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label"),
  userAgent: text("user_agent"),
  referer: text("referer"),
  sort: integer("sort").notNull().default(0),
}, t => [
  index("idx_media_live_streams_channel").on(t.channelId, t.sort),
]);
