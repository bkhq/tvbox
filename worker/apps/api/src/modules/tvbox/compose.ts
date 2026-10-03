import type { JsonObject, ListKind } from "./parse";
import { LIST_KINDS } from "./parse";

/** Globals written before the lists, in this order; every other global follows them. */
const HEAD_GLOBALS = ["spider", "wallpaper", "logo"];

export interface ComposeEntry {
  readonly id: string;
  readonly kind: ListKind;
  readonly upstreamId: string | null;
  readonly enabled: boolean;
  readonly sort: number;
  readonly data: JsonObject;
}

export interface ComposeInput {
  readonly globals: readonly { readonly key: string; readonly value: unknown }[];
  readonly entries: readonly ComposeEntry[];
}

/** Build the TVBox config clients receive. */
export function compose({ globals, entries }: ComposeInput): JsonObject {
  const out: JsonObject = {};
  const byKey = new Map(globals.map(g => [g.key, g.value]));
  for (const key of HEAD_GLOBALS) {
    if (byKey.has(key))
      out[key] = byKey.get(key);
  }

  for (const kind of LIST_KINDS) {
    const rows = entries
      .filter(e => e.kind === kind && e.enabled)
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    if (rows.length === 0)
      continue;
    out[kind] = kind === "sites" ? homeFirst(uniqueSiteKeys(rows)) : rows.map(r => r.data);
  }

  for (const { key, value } of globals) {
    if (!HEAD_GLOBALS.includes(key))
      out[key] = value;
  }
  return out;
}

// TVBox keys history and favourites by site key, so two upstreams shipping
// the same key must not collide. The first one keeps it.
function uniqueSiteKeys(rows: readonly ComposeEntry[]): JsonObject[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    let key = String(row.data.key ?? row.id);
    if (seen.has(key))
      key = `${key}_${(row.upstreamId ?? "local").slice(0, 6)}`;
    seen.add(key);
    return key === row.data.key ? row.data : { ...row.data, key };
  });
}

// TVBox opens the first site as home until the user picks one. Search-only
// aggregators and config centres are marked `searchable: 0` and have no home
// content, so a list that starts with one shows an empty home. Lead with the
// first searchable site instead (absent means searchable) and keep the rest.
function homeFirst(sites: JsonObject[]): JsonObject[] {
  const searchable = (site: JsonObject) => Number(site.searchable ?? 1) !== 0;
  if (sites.length === 0 || searchable(sites[0]!))
    return sites;
  const index = sites.findIndex(searchable);
  if (index < 0)
    return sites;
  return [sites[index]!, ...sites.slice(0, index), ...sites.slice(index + 1)];
}

/** What a publish stores: enabled entries with their source, and the globals. */
export interface PublishedSnapshot {
  readonly version: 2;
  readonly globals: ComposeInput["globals"];
  readonly entries: readonly ComposeEntry[];
}

/**
 * The config one device receives: entries from its upstreams (every upstream
 * when `upstreams` is null) plus the common entries added here.
 */
export function composeForDevice(snapshot: PublishedSnapshot, upstreams: readonly string[] | null): JsonObject {
  const allowed = upstreams === null ? null : new Set(upstreams);
  return compose({
    globals: snapshot.globals,
    entries: snapshot.entries.filter(e => e.upstreamId === null || allowed === null || allowed.has(e.upstreamId)),
  });
}
