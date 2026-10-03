import { http } from "@/shared/lib/http";

export const LIST_KINDS = ["sites", "parses", "lives", "rules", "doh"] as const;
export type ListKind = typeof LIST_KINDS[number];
export type JsonObject = Record<string, unknown>;

export interface Upstream {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly isPrimary: boolean;
  readonly syncEnabled: boolean;
  readonly lastSyncedAt: string | null;
  readonly lastStatus: "ok" | "error" | null;
  readonly lastError: string | null;
  readonly entryCount: number;
  readonly deviceCount: number;
}

export interface Entry {
  readonly id: string;
  readonly kind: ListKind;
  readonly upstreamId: string | null;
  readonly upstreamKey: string | null;
  readonly data: JsonObject;
  readonly upstreamData: JsonObject | null;
  readonly enabled: boolean;
  readonly sort: number;
  readonly locallyModified: boolean;
  readonly upstreamRemoved: boolean;
  readonly healthStatus: "ok" | "blocked" | "fail" | "skip" | null;
  readonly healthDetail: string | null;
  readonly healthCheckedAt: string | null;
  readonly disabledByHealth: boolean;
  readonly healthExempt: boolean;
}

export interface Global {
  readonly key: string;
  readonly value: unknown;
  readonly upstreamValue: unknown;
  readonly locallyModified: boolean;
}

export interface Publish {
  readonly id: string;
  readonly sha256: string;
  readonly size: number;
  readonly counts: string;
  readonly trigger: "manual" | "sync" | "restore";
  readonly restoredFrom: string | null;
  readonly createdAt: string;
}

export interface Device {
  readonly id: string;
  readonly name: string;
  /** null for devices created before URLs were kept: regenerate to see one. */
  readonly token: string | null;
  readonly hint: string;
  readonly enabled: boolean;
  readonly allUpstreams: boolean;
  readonly upstreamIds: readonly string[];
  readonly note: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  /** The app linked through Server link, most recently seen. */
  readonly link: AppInfo & { readonly lastSeenAt: string } | null;
}

interface AppInfo {
  readonly name: string;
  readonly model: string;
  readonly mode: string;
  readonly abi: string;
  readonly versionName: string;
}

/** A TVBox app asking to be linked; `code` is what its screen shows. */
export interface Enrollment extends AppInfo {
  readonly id: string;
  readonly code: string;
  readonly status: "pending" | "approved" | "rejected" | "unlinked";
  readonly deviceRef: string | null;
  readonly deviceName: string | null;
  readonly ip: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

/** Entry source filter: everything, the common entries, or one upstream. */
export type EntrySource = "all" | "common" | string;

export interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly assets: { readonly mirrored: number; readonly failed: readonly string[] };
}

export const tvboxKeys = {
  upstreams: ["tvbox", "upstreams"] as const,
  entries: (kind: ListKind, source: EntrySource) => ["tvbox", "entries", kind, source] as const,
  globals: ["tvbox", "globals"] as const,
  publishes: ["tvbox", "publishes"] as const,
  devices: ["tvbox", "devices"] as const,
  enrollments: ["tvbox", "enrollments"] as const,
};

async function data<T>(path: string, init?: RequestInit): Promise<T> {
  return (await http<{ data: T }>(path, init)).data;
}

function send(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) };
}

export const tvboxApi = {
  upstreams: () => data<Upstream[]>("/tvbox/upstreams"),
  createUpstream: (body: { name: string; url: string }) => data<Upstream>("/tvbox/upstreams", send("POST", body)),
  updateUpstream: (id: string, body: Partial<{ name: string; url: string; syncEnabled: boolean; isPrimary: true }>) =>
    data<Upstream>(`/tvbox/upstreams/${id}`, send("PATCH", body)),
  deleteUpstream: (id: string) => data<Upstream>(`/tvbox/upstreams/${id}`, send("DELETE")),
  syncUpstream: (id: string) => data<SyncResult>(`/tvbox/upstreams/${id}/sync`, send("POST")),

  entries: (kind: ListKind, source: EntrySource) =>
    data<Entry[]>(`/tvbox/entries?kind=${kind}${source === "all" ? "" : `&source=${encodeURIComponent(source)}`}`),
  setEntriesEnabled: (ids: readonly string[], enabled: boolean) => data<{ count: number }>("/tvbox/entries/bulk", send("POST", { ids, enabled })),
  createEntry: (kind: ListKind, entry: JsonObject) => data<Entry>("/tvbox/entries", send("POST", { kind, data: entry })),
  updateEntry: (id: string, body: { data?: JsonObject; enabled?: boolean; healthExempt?: boolean }) => data<Entry>(`/tvbox/entries/${id}`, send("PATCH", body)),
  revertEntry: (id: string) => data<Entry>(`/tvbox/entries/${id}/revert`, send("POST")),
  deleteEntry: (id: string) => data<Entry>(`/tvbox/entries/${id}`, send("DELETE")),
  reorderEntries: (kind: ListKind, ids: readonly string[]) => data<{ count: number }>("/tvbox/entries/reorder", send("POST", { kind, ids })),

  globals: () => data<Global[]>("/tvbox/globals"),
  putGlobal: (key: string, value: unknown) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}`, send("PUT", { value })),
  revertGlobal: (key: string) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}/revert`, send("POST")),
  deleteGlobal: (key: string) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}`, send("DELETE")),

  preview: (deviceId?: string) => data<JsonObject>(`/tvbox/preview${deviceId ? `?deviceId=${deviceId}` : ""}`),
  publishes: () => data<Publish[]>("/tvbox/publishes"),
  publish: () => data<Publish>("/tvbox/publishes", send("POST")),
  restore: (id: string) => data<Publish>(`/tvbox/publishes/${id}/restore`, send("POST")),

  devices: () => data<Device[]>("/tvbox/devices"),
  createDevice: (body: { name: string; note?: string; upstreamIds: readonly string[] | null }) => data<Device>("/tvbox/devices", send("POST", body)),
  updateDevice: (id: string, body: { name?: string; note?: string; enabled?: boolean; upstreamIds?: readonly string[] | null }) =>
    data<Device>(`/tvbox/devices/${id}`, send("PATCH", body)),
  rotateDevice: (id: string) => data<Device>(`/tvbox/devices/${id}/rotate`, send("POST")),
  deleteDevice: (id: string) => data<Device>(`/tvbox/devices/${id}`, send("DELETE")),

  enrollments: () => data<Enrollment[]>("/tvbox/enrollments"),
  approveEnrollment: (id: string, body: { deviceId?: string; name?: string; upstreamIds?: readonly string[] | null }) =>
    data<Enrollment>(`/tvbox/enrollments/${id}/approve`, send("POST", body)),
  rejectEnrollment: (id: string) => data<Enrollment>(`/tvbox/enrollments/${id}/reject`, send("POST")),
  deleteEnrollment: (id: string) => data<Enrollment>(`/tvbox/enrollments/${id}`, send("DELETE")),
};

/** Subscription URL a TVBox client is given for a token. */
export function subscriptionUrl(token: string): string {
  return `${window.location.origin}/s/${token}/api.json`;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
