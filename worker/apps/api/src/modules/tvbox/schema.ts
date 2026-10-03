import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

const now = () => new Date().toISOString();

// A TVBox config we import from. Exactly one upstream is primary: its globals
// (spider, wallpaper, flags, …) become ours. Sites from the others carry their
// own spider in the site-level `jar` field.
export const tvboxUpstreams = sqliteTable("tvbox_upstreams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  lastStatus: text("last_status", { enum: ["ok", "error"] }),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

// One row per entry of `sites` / `parses` / `lives` / `rules` / `doh`.
// `data` is what we publish; `upstreamData` is the last copy the upstream
// served. Sync overwrites `data` only while `locallyModified` is false, so a
// local edit survives and the UI can still show what the upstream changed.
// Local entries have no upstream.
export const tvboxEntries = sqliteTable("tvbox_entries", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["sites", "parses", "lives", "rules", "doh"] }).notNull(),
  upstreamId: text("upstream_id").references(() => tvboxUpstreams.id, { onDelete: "cascade" }),
  upstreamKey: text("upstream_key"),
  data: text("data").notNull(),
  upstreamData: text("upstream_data"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
  locallyModified: integer("locally_modified", { mode: "boolean" }).notNull().default(false),
  upstreamRemoved: integer("upstream_removed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, t => [
  uniqueIndex("idx_tvbox_entries_upstream_key").on(t.upstreamId, t.kind, t.upstreamKey),
  index("idx_tvbox_entries_kind_sort").on(t.kind, t.sort),
]);

// Top-level fields other than the lists, as JSON values. Same
// local-edit rule as entries.
export const tvboxGlobals = sqliteTable("tvbox_globals", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  upstreamValue: text("upstream_value"),
  locallyModified: integer("locally_modified", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

// Upstream files we mirror into blob storage, keyed by where they came from.
// The blob itself is content-addressed (`deriveStorageKey(sha256)`), so the
// published config references `./a/<sha256>/<name>` and never goes stale.
export const tvboxAssets = sqliteTable("tvbox_assets", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  sha256: text("sha256").notNull(),
  md5: text("md5").notNull(),
  size: integer("size").notNull(),
  name: text("name").notNull(),
  fetchedAt: text("fetched_at").notNull().$defaultFn(now),
}, t => [
  uniqueIndex("idx_tvbox_assets_source").on(t.sourceUrl),
]);

// Every published config. The newest row is live; restoring an older one
// publishes its JSON again as a new row.
export const tvboxPublishes = sqliteTable("tvbox_publishes", {
  id: text("id").primaryKey(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  // JSON object: entry count per list kind.
  counts: text("counts").notNull(),
  trigger: text("trigger", { enum: ["manual", "sync", "restore"] }).notNull(),
  restoredFrom: text("restored_from"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// Subscription tokens, one per device. Only a SHA-256 is stored; `hint` is
// the last characters, so the UI can tell tokens apart.
export const tvboxTokens = sqliteTable("tvbox_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  hint: text("hint").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, t => [
  uniqueIndex("idx_tvbox_tokens_hash").on(t.tokenHash),
]);

// App releases registered by CI. The APKs are uploaded straight to the
// bucket (`tvbox/releases/<versionCode>/<mode>-<abi>.apk`); these rows hold
// what the update manifests need. A withdrawn release stays listed but is
// never offered.
export const tvboxReleases = sqliteTable("tvbox_releases", {
  id: text("id").primaryKey(),
  versionCode: integer("version_code").notNull(),
  versionName: text("version_name").notNull(),
  channel: text("channel", { enum: ["stable", "beta"] }).notNull().default("stable"),
  notes: text("notes").notNull().default(""),
  withdrawn: integer("withdrawn", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, t => [
  uniqueIndex("idx_tvbox_releases_version").on(t.versionCode),
]);

export const tvboxReleaseAssets = sqliteTable("tvbox_release_assets", {
  id: text("id").primaryKey(),
  releaseId: text("release_id").notNull().references(() => tvboxReleases.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  abi: text("abi").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
}, t => [
  uniqueIndex("idx_tvbox_release_assets_flavor").on(t.releaseId, t.mode, t.abi),
]);
