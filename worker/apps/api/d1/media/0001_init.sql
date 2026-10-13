-- Read model of the media library (docs/plan/media-library.md, part 3).
-- Written only by publishing (modules/media/readmodel), read by the Worker.
-- Documents are the native API's JSON; the other columns exist to filter,
-- sort and page. Every row carries the hash of what it was written from, so
-- a publish rewrites only what changed.

CREATE TABLE rm_titles (
  id INTEGER PRIMARY KEY,
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
  title_id INTEGER NOT NULL,
  PRIMARY KEY (genre_id, title_id)
) WITHOUT ROWID;
CREATE INDEX idx_rm_title_genres_title ON rm_title_genres (title_id);

CREATE TABLE rm_seasons (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_seasons_title ON rm_seasons (title_id, number);

-- One row per movie (`t<id>`) or episode (`e<id>`) with something to play.
CREATE TABLE rm_playback (
  id TEXT PRIMARY KEY,
  title_id INTEGER NOT NULL,
  season_id INTEGER,
  episode_number INTEGER,
  json TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_rm_playback_season ON rm_playback (season_id, episode_number);
CREATE INDEX idx_rm_playback_title ON rm_playback (title_id);

CREATE TABLE rm_people (
  id INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE rm_collections (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- Home rows; rule rows are expanded into titles when publishing.
CREATE TABLE rm_rows (
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE rm_row_items (
  row_id TEXT NOT NULL,
  sort INTEGER NOT NULL,
  title_id INTEGER NOT NULL,
  PRIMARY KEY (row_id, sort)
) WITHOUT ROWID;

-- Titles (`t<id>`) and people (`p<id>`) by name.
CREATE VIRTUAL TABLE rm_search USING fts5(ref UNINDEXED, hash UNINDEXED, text, tokenize = 'trigram');

-- The Apple CMS layer's items: a movie, or one season of a series, with
-- its `vod` as a list item and as a detail (with the play lists).
CREATE TABLE rm_cms_items (
  vod_id TEXT PRIMARY KEY,
  title_id INTEGER NOT NULL,
  season_id INTEGER,
  type_id TEXT NOT NULL,
  year INTEGER,
  country TEXT,
  -- ",g18,g28,": matched with LIKE '%,<id>,%'.
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

-- generation, manifest, facets per category, home hero, live.
CREATE TABLE rm_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
