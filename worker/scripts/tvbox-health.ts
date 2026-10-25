#!/usr/bin/env bun
/**
 * Probe every TVBox entry on a deployment and report which look dead.
 *
 * It lists entries through the console API and checks what each one points at
 * from wherever it runs (a CI runner is a datacenter, not a viewer's network,
 * so a "dead" site may still work at home). With `--apply` the results go back
 * to the deployment, which disables failing entries and re-enables recovered
 * ones (entries an admin forced on are left alone), and the config is
 * published when anything changed.
 *
 *   lives    the playlist downloads and looks like m3u / txt
 *   parses   the parser answers
 *   doh      the resolver answers
 *
 * Only what the app would also fail on counts as dead: no connection, a
 * timeout, 5xx (but 505: an HTTP/2-only server such as a DoH resolver
 * refusing this HTTP/1.1 client is up), or 404/410. Certificates are not checked (the app trusts
 * any), and 401/403/429 mean the server is up but refuses this network, so
 * they are reported as blocked rather than dead. A failed probe is retried
 * once.
 *   sites    type 0/1: the CMS API returns JSON/XML for ac=list;
 *            type 3: a JS/Python spider downloads, or one of the hosts its
 *            ext names answers. Spiders with no URL of their own (hosts live
 *            inside the jar) cannot be checked and are skipped.
 *
 * Usage:
 *   TVBOX_URL=https://tv.bk.io/mg TVBOX_API_TOKEN=… bun scripts/tvbox-health.ts [--apply] [--json report.json]
 */
/* eslint-disable no-console */
import { writeFileSync } from "node:fs";
import process from "node:process";

type Kind = "sites" | "parses" | "lives" | "rules" | "doh";

interface Entry {
  readonly id: string;
  readonly kind: Kind;
  readonly upstreamId: string | null;
  readonly enabled: boolean;
  readonly data: Record<string, unknown>;
}

export interface Probe {
  readonly url: string;
  /** What the response has to look like, beyond "the server answered". */
  readonly expect: "alive" | "playlist" | "cms";
}

export interface Result {
  readonly id: string;
  readonly kind: Kind;
  readonly name: string;
  readonly status: "ok" | "blocked" | "fail" | "skip";
  readonly detail: string;
}

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 16;
const MAX_PROBES = 3;
const USER_AGENT = "okhttp/4.12.0";
const RE_PLAYLIST = /#EXTM3U|#genre#|,\s*https?:\/\//i;
const RE_LOCAL = /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::|\/|$)/i;

function isRemote(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value) && !RE_LOCAL.test(value);
}

// Some ext values list several sites in one string ("https://a,https://b").
function remoteStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string")
    out.push(...value.split(/[\s,]+/).filter(isRemote));
  else if (Array.isArray(value))
    value.forEach(v => remoteStrings(v, out));
  else if (value !== null && typeof value === "object")
    Object.values(value).forEach(v => remoteStrings(v, out));
  return out;
}

/** What to request for an entry; empty when there is nothing to check. */
export function probesFor(kind: Kind, data: Record<string, unknown>): Probe[] {
  if (kind === "lives") {
    return isRemote(data.url)
      ? [
          { url: data.url, expect: "playlist" },
        ]
      : [];
  }
  if (kind === "parses" || kind === "doh") {
    return isRemote(data.url)
      ? [
          { url: data.url, expect: "alive" },
        ]
      : [];
  }
  if (kind !== "sites")
    return [];

  const type = Number(data.type);
  if ((type === 0 || type === 1) && isRemote(data.api)) {
    return [
      { url: `${data.api}${data.api.includes("?")
        ? "&"
        : "?"}ac=list`, expect: "cms" },
    ];
  }

  // A spider script, else what its ext points at: one probe per host.
  const urls = [
    ...(isRemote(data.api)
      ? [data.api]
      : []),
    ...remoteStrings(data.ext),
  ];
  const seen = new Set<string>();
  const probes: Probe[] = [];
  for (const url of urls) {
    const host = new URL(url).host;
    if (seen.has(host))
      continue;
    seen.add(host);
    // The URL as configured: buckets and file hosts refuse their root.
    probes.push({ url, expect: "alive" });
    if (probes.length === MAX_PROBES)
      break;
  }
  return probes;
}

interface Outcome { readonly status: "ok" | "blocked" | "fail"; readonly detail: string }

const BLOCKED = new Set([401, 403, 429]);
const GONE = new Set([404, 410]);

async function probeOnce(p: Probe): Promise<Outcome> {
  try {
    const res = await fetch(p.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
      // Bun: the app trusts any certificate, so an expired one is not dead.
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    const detail = `${p.url} → ${res.status}`;
    if ((res.status >= 500 && res.status !== 505) || (p.expect !== "alive" && GONE.has(res.status))) {
      await res.body?.cancel();
      return { status: "fail", detail };
    }
    if (BLOCKED.has(res.status)) {
      await res.body?.cancel();
      return { status: "blocked", detail };
    }
    if (p.expect === "alive") {
      await res.body?.cancel();
      return { status: "ok", detail };
    }
    const text = (await res.text()).slice(0, 256 * 1024);
    if (p.expect === "playlist" && !RE_PLAYLIST.test(text))
      return { status: "fail", detail: `${p.url} → not a playlist` };
    if (p.expect === "cms" && !/^\s*[[{<]/.test(text))
      return { status: "fail", detail: `${p.url} → not a CMS response` };
    return { status: "ok", detail };
  }
  catch (err) {
    const reason = err instanceof Error
      ? (err.name === "TimeoutError"
          ? "timeout"
          : err.message.split(". For more")[0]!)
      : String(err);
    return { status: "fail", detail: `${p.url} → ${reason}` };
  }
}

async function probe(p: Probe): Promise<Outcome> {
  const first = await probeOnce(p);
  return first.status === "fail"
    ? await probeOnce(p)
    : first;
}

/** Alive when any probe is; skipped when there is nothing to probe. */
export async function check(entry: Entry): Promise<Result> {
  const name = String(entry.data.name ?? entry.data.key ?? entry.id);
  const probes = probesFor(entry.kind, entry.data);
  if (probes.length === 0) {
    return {
      id: entry.id,
      kind: entry.kind,
      name,
      status: "skip",
      detail: "nothing to check",
    };
  }
  const outcomes: Outcome[] = [];
  for (const p of probes) {
    const r = await probe(p);
    if (r.status === "ok") {
      return {
        id: entry.id,
        kind: entry.kind,
        name,
        status: "ok",
        detail: r.detail,
      };
    }
    outcomes.push(r);
  }
  const status = outcomes.some(o => o.status === "blocked")
    ? "blocked"
    : "fail";
  return {
    id: entry.id,
    kind: entry.kind,
    name,
    status,
    detail: outcomes.map(o => o.detail).join("; "),
  };
}

export interface Applied {
  readonly recorded: number;
  readonly disabled: readonly string[];
  readonly enabled: readonly string[];
}

type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** Console API calls with an API token; `base` is the origin plus BASE_PATH. */
export function client(base: string, token: string): Call {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}/api${path}`, {
      method,
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
          }),
    });
    if (!r.ok)
      throw new Error(`${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return ((await r.json()) as { data: T }).data;
  };
}

/** Probe every entry on the deployment and print a summary. */
export async function checkAll(call: Call): Promise<Result[]> {
  const entries = (await call<Entry[]>("GET", "/tvbox/entries")).filter(e => e.kind !== "rules");

  const results: Result[] = [];
  const queue = [...entries];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let e = queue.shift(); e; e = queue.shift())
      results.push(await check(e));
  }));

  const byKind = new Map<Kind, Record<Result["status"], number>>();
  for (const r of results) {
    const counts = byKind.get(r.kind) ?? { ok: 0, blocked: 0, fail: 0, skip: 0 };
    counts[r.status]++;
    byKind.set(r.kind, counts);
  }
  for (const [kind, c] of byKind)
    console.log(`${kind.padEnd(7)} ok ${c.ok}  blocked ${c.blocked}  fail ${c.fail}  skip ${c.skip}`);
  for (const status of ["fail", "blocked"] as const) {
    console.log(`\n${status}:`);
    for (const r of results.filter(r => r.status === status).sort((a, b) => a.kind.localeCompare(b.kind)))
      console.log(`  [${r.kind}] ${r.name}: ${r.detail}`);
  }
  return results;
}

/** Hand the results to the deployment, which switches entries on and off. */
export async function applyResults(call: Call, results: readonly Result[]): Promise<Applied> {
  const outcome = await call<Applied>("POST", "/tvbox/health", {
    results: results.map(({ id, status, detail }) => ({ id, status, detail })),
  });
  console.log(`\napplied: ${outcome.recorded} recorded`);
  for (const name of outcome.disabled)
    console.log(`  disabled  ${name}`);
  for (const name of outcome.enabled)
    console.log(`  enabled   ${name}`);
  return outcome;
}

async function main(): Promise<void> {
  const base = process.env.TVBOX_URL?.replace(/\/+$/, "");
  const token = process.env.TVBOX_API_TOKEN;
  if (!base || !token)
    throw new Error("TVBOX_URL and TVBOX_API_TOKEN must be set");
  const call = client(base, token);

  const results = await checkAll(call);

  const jsonAt = process.argv.indexOf("--json");
  if (jsonAt !== -1 && process.argv[jsonAt + 1])
    writeFileSync(process.argv[jsonAt + 1]!, JSON.stringify(results, null, 2));

  if (process.argv.includes("--apply")) {
    const outcome = await applyResults(call, results);
    if (outcome.disabled.length + outcome.enabled.length > 0) {
      const p = await call<{ id: string; counts: string }>("POST", "/tvbox/publishes");
      console.log(`published ${p.id} ${p.counts}`);
    }
    else {
      console.log("nothing switched; not published");
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  }
  catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
