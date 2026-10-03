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

export interface Token {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly assets: { readonly mirrored: number; readonly failed: readonly string[] };
}

export const tvboxKeys = {
  upstreams: ["tvbox", "upstreams"] as const,
  entries: (kind: ListKind) => ["tvbox", "entries", kind] as const,
  globals: ["tvbox", "globals"] as const,
  publishes: ["tvbox", "publishes"] as const,
  tokens: ["tvbox", "tokens"] as const,
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

  entries: (kind: ListKind) => data<Entry[]>(`/tvbox/entries?kind=${kind}`),
  createEntry: (kind: ListKind, entry: JsonObject) => data<Entry>("/tvbox/entries", send("POST", { kind, data: entry })),
  updateEntry: (id: string, body: { data?: JsonObject; enabled?: boolean }) => data<Entry>(`/tvbox/entries/${id}`, send("PATCH", body)),
  revertEntry: (id: string) => data<Entry>(`/tvbox/entries/${id}/revert`, send("POST")),
  deleteEntry: (id: string) => data<Entry>(`/tvbox/entries/${id}`, send("DELETE")),
  reorderEntries: (kind: ListKind, ids: readonly string[]) => data<{ count: number }>("/tvbox/entries/reorder", send("POST", { kind, ids })),

  globals: () => data<Global[]>("/tvbox/globals"),
  putGlobal: (key: string, value: unknown) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}`, send("PUT", { value })),
  revertGlobal: (key: string) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}/revert`, send("POST")),
  deleteGlobal: (key: string) => data<Global>(`/tvbox/globals/${encodeURIComponent(key)}`, send("DELETE")),

  preview: () => data<JsonObject>("/tvbox/preview"),
  publishes: () => data<Publish[]>("/tvbox/publishes"),
  publish: () => data<Publish>("/tvbox/publishes", send("POST")),
  restore: (id: string) => data<Publish>(`/tvbox/publishes/${id}/restore`, send("POST")),

  tokens: () => data<Token[]>("/tvbox/tokens"),
  createToken: (name: string) => data<Token & { token: string }>("/tvbox/tokens", send("POST", { name })),
  updateToken: (id: string, body: { enabled?: boolean; name?: string }) => data<Token>(`/tvbox/tokens/${id}`, send("PATCH", body)),
  deleteToken: (id: string) => data<Token>(`/tvbox/tokens/${id}`, send("DELETE")),
};

/** Subscription URL a TVBox client is given for a token. */
export function subscriptionUrl(token: string): string {
  return `${window.location.origin}/s/${token}/api.json`;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
