-- What devices see: the ids a publish marked live. The Worker reads the
-- source tables directly, so the projected read model goes away.
CREATE TABLE media_published (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX idx_media_published_kind ON media_published (kind);

DROP TABLE IF EXISTS rm_titles;
DROP TABLE IF EXISTS rm_title_genres;
DROP TABLE IF EXISTS rm_seasons;
DROP TABLE IF EXISTS rm_playback;
DROP TABLE IF EXISTS rm_people;
DROP TABLE IF EXISTS rm_collections;
DROP TABLE IF EXISTS rm_rows;
DROP TABLE IF EXISTS rm_row_items;
DROP TABLE IF EXISTS rm_search;
DROP TABLE IF EXISTS rm_cms_items;
DROP TABLE IF EXISTS rm_meta;
