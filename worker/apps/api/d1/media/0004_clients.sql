-- Clients read the library through their own URL (`/m/<token>/…`) and see
-- public titles plus the titles of their channels. What is live is the
-- editors' `publish_state`; publishing no longer marks ids.
CREATE TABLE media_clients (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  enabled INTEGER DEFAULT 1 NOT NULL,
  note TEXT DEFAULT '' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_media_clients_token ON media_clients (token_hash);

CREATE TABLE media_channels (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_media_channels_name ON media_channels (name);

CREATE TABLE media_client_channels (
  client_id TEXT NOT NULL REFERENCES media_clients(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES media_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, channel_id)
);
CREATE INDEX idx_media_client_channels_channel ON media_client_channels (channel_id);

CREATE TABLE media_title_channels (
  title_id TEXT NOT NULL REFERENCES media_titles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES media_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (title_id, channel_id)
);
CREATE INDEX idx_media_title_channels_channel ON media_title_channels (channel_id);

ALTER TABLE media_titles ADD COLUMN public INTEGER DEFAULT 0 NOT NULL;

DROP TABLE IF EXISTS media_published;
DELETE FROM media_settings WHERE key = 'published_generation';
