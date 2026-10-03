import type { Entry } from "./-tvbox-api";

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
  return Array.isArray(hosts) ? hosts.join(", ") : "";
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
  return n ? rows.filter(r => JSON.stringify(r.data).toLowerCase().includes(n)) : rows;
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
