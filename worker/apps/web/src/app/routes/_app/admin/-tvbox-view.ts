import type { Entry, Upstream } from "./-tvbox-api";

/** Display name of an entry: its name, else its key. */
export function entryTitle(entry: Pick<Entry, "id" | "data" | "upstreamKey">): string {
  const { name, key } = entry.data;
  return String(name ?? key ?? entry.upstreamKey ?? entry.id);
}

/** Second line: what the entry points at. */
export function entrySubtitle(entry: Pick<Entry, "kind" | "data">): string {
  const { key, api, url, hosts } = entry.data;
  if (entry.kind === "sites")
    return `${String(key)} · ${String(api ?? "")}`;
  if (typeof url === "string")
    return url;
  return Array.isArray(hosts)
    ? hosts.join(", ")
    : "";
}

export type HealthFilter = "all" | "fail" | "disabledByHealth" | "exempt";

/** Entries matching a health filter. */
export function filterHealth<T extends Pick<Entry, "healthStatus" | "disabledByHealth" | "healthExempt">>(rows: readonly T[], filter: HealthFilter): readonly T[] {
  if (filter === "fail")
    return rows.filter(r => r.healthStatus === "fail");
  if (filter === "disabledByHealth")
    return rows.filter(r => r.disabledByHealth);
  if (filter === "exempt")
    return rows.filter(r => r.healthExempt);
  return rows;
}

/** Entries whose JSON contains `needle`, case-insensitively; all of them for an empty needle. */
export function filterEntries<T extends Pick<Entry, "data">>(rows: readonly T[], needle: string): readonly T[] {
  const n = needle.trim().toLowerCase();
  return n
    ? rows.filter(r => JSON.stringify(r.data).toLowerCase().includes(n))
    : rows;
}

/** `ids` with `id` moved by `delta`, or null when it would leave the list. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length)
    return null;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
}

/** "sites 103 · parses 9" from a publish's per-kind counts, skipping empty kinds. */
export function countsText(counts: string): string {
  return Object.entries(JSON.parse(counts) as Record<string, number>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

type UpstreamNode = Pick<Upstream, "id" | "name" | "parentId">;

/** Upstreams in display order: each collection followed by its lines. */
export function upstreamTree<T extends UpstreamNode>(upstreams: readonly T[]): { upstream: T; depth: 0 | 1; lines: number }[] {
  const ids = new Set(upstreams.map(u => u.id));
  const out: { upstream: T; depth: 0 | 1; lines: number }[] = [];
  for (const u of upstreams) {
    if (u.parentId !== null && ids.has(u.parentId))
      continue;
    const lines = upstreams.filter(l => l.parentId === u.id);
    out.push({ upstream: u, depth: 0, lines: lines.length }, ...lines.map(l => ({ upstream: l, depth: 1 as const, lines: 0 })));
  }
  return out;
}

/** A line is named after its collection. */
export function upstreamLabel(upstream: UpstreamNode, upstreams: readonly UpstreamNode[]): string {
  const parent = upstream.parentId === null
    ? undefined
    : upstreams.find(u => u.id === upstream.parentId);
  return parent
    ? `${parent.name} / ${upstream.name}`
    : upstream.name;
}

export type SiteEngine = "cmsJson" | "cmsXml" | "own" | "jar" | "js" | "python";

/** How the app runs a site: a CMS API it calls itself, or a spider. */
export function siteEngine(data: { readonly type?: unknown; readonly api?: unknown; readonly jar?: unknown }): SiteEngine | null {
  const type = Number(data.type);
  const api = typeof data.api === "string"
    ? data.api.split("?")[0]!
    : "";
  if (type === 0)
    return "cmsXml";
  if (type === 1 || type === 4)
    return "cmsJson";
  if (type !== 3)
    return null;
  if (api.endsWith(".js"))
    return "js";
  if (api.endsWith(".py"))
    return "python";
  if (!api.startsWith("csp_"))
    return null;
  return data.jar === "@tvbox"
    ? "own"
    : "jar";
}
