import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
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
  // A line of a collection (a config of `urls`): created, renamed away from
  // and deleted by syncing its collection.
  parentId: text("parent_id").references((): AnySQLiteColumn => tvboxUpstreams.id, { onDelete: "cascade" }),
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
  // Deleted here: an upstream entry is kept, hidden and disabled, so that a
  // sync does not bring it back. It can be restored.
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  // The last health check (scripts/tvbox-health.ts, run by CI). A failing
  // entry is disabled and flagged `disabledByHealth`, and enabled again once
  // it passes. Turning such an entry back on by hand makes it `healthExempt`:
  // checks still run but never switch it off.
  healthStatus: text("health_status", { enum: ["ok", "blocked", "fail", "skip"] }),
  healthDetail: text("health_detail"),
  healthCheckedAt: text("health_checked_at"),
  disabledByHealth: integer("disabled_by_health", { mode: "boolean" }).notNull().default(false),
  healthExempt: integer("health_exempt", { mode: "boolean" }).notNull().default(false),
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

// Devices, one subscription URL each. The table keeps its original name
// from when a device was only a token. `token` is kept so the URL can be
// shown again; rows from before that have only the hash, and show their URL
// once it is regenerated. `allUpstreams` devices get every upstream, the
// others only those in `tvbox_device_upstreams`; entries added here (no
// upstream) go to every device.
export const tvboxDevices = sqliteTable("tvbox_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  token: text("token"),
  tokenHash: text("token_hash").notNull(),
  hint: text("hint").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  allUpstreams: integer("all_upstreams", { mode: "boolean" }).notNull().default(true),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at"),
}, t => [
  uniqueIndex("idx_tvbox_tokens_hash").on(t.tokenHash),
]);

export const tvboxDeviceUpstreams = sqliteTable("tvbox_device_upstreams", {
  deviceId: text("device_id").notNull().references(() => tvboxDevices.id, { onDelete: "cascade" }),
  upstreamId: text("upstream_id").notNull().references(() => tvboxUpstreams.id, { onDelete: "cascade" }),
}, t => [
  uniqueIndex("idx_tvbox_device_upstreams_pair").on(t.deviceId, t.upstreamId),
  index("idx_tvbox_device_upstreams_upstream").on(t.upstreamId),
]);

// A TVBox app asking to be linked (Settings → Server link). The device shows
// `code`; an admin approves it here, which attaches it to a device and hands
// the app that device's subscription URL. Everything else is what the app
// reports, kept for the admin to recognise it.
export const tvboxEnrollments = sqliteTable("tvbox_enrollments", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "unlinked"] }).notNull().default("pending"),
  deviceRef: text("device_ref").references(() => tvboxDevices.id, { onDelete: "set null" }),
  appDeviceId: text("app_device_id").notNull().default(""),
  name: text("name").notNull().default(""),
  model: text("model").notNull().default(""),
  mode: text("mode").notNull().default(""),
  abi: text("abi").notNull().default(""),
  versionCode: integer("version_code").notNull().default(0),
  versionName: text("version_name").notNull().default(""),
  ip: text("ip").notNull().default(""),
  // Handed to an approved app that can send it back (X-Device-Id and
  // X-Device-Key); while it is set the device's config is served to that
  // app only. Kept readable so every approved answer can repeat it.
  deviceKey: text("device_key"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  lastSeenAt: text("last_seen_at").notNull().$defaultFn(now),
  resolvedAt: text("resolved_at"),
}, t => [
  uniqueIndex("idx_tvbox_enrollments_code").on(t.code),
  index("idx_tvbox_enrollments_device").on(t.deviceRef),
]);

// App releases registered by CI. The binaries are uploaded straight to the
// bucket (`tvbox/releases/<versionCode>/<mode>-<abi>.apk` for the Java app,
// `tvbox/rn/releases/…` for the React Native one); these rows hold what the
// update manifests need. A withdrawn release stays listed but is never
// offered.
export const tvboxReleases = sqliteTable("tvbox_releases", {
  id: text("id").primaryKey(),
  app: text("app", { enum: ["tvbox", "rn"] }).notNull().default("tvbox"),
  versionCode: integer("version_code").notNull(),
  versionName: text("version_name").notNull(),
  channel: text("channel", { enum: ["stable", "beta"] }).notNull().default("stable"),
  notes: text("notes").notNull().default(""),
  withdrawn: integer("withdrawn", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, t => [
  uniqueIndex("idx_tvbox_releases_version").on(t.app, t.versionCode),
]);

export const tvboxReleaseAssets = sqliteTable("tvbox_release_assets", {
  id: text("id").primaryKey(),
  releaseId: text("release_id").notNull().references(() => tvboxReleases.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  abi: text("abi").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  // iOS/tvOS builds of the React Native app: the itms-services manifest
  // needs it.
  bundleId: text("bundle_id"),
}, t => [
  uniqueIndex("idx_tvbox_release_assets_flavor").on(t.releaseId, t.mode, t.abi),
]);
