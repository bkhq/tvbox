#!/usr/bin/env bun
/**
 * Apply the declared TVBox upstreams to a deployment, sync them and publish.
 *
 * Upstreams are matched by URL: a declared one that is missing is created,
 * one whose name or sync flag differs is updated, and `primary: true` makes
 * it the primary. Upstreams added in the admin console but not declared here
 * are left alone, but synced when their sync flag is on.
 *
 * `tvbox/doh.json` next to the upstreams file declares the DoH resolvers
 * every device gets: common DoH entries are matched by URL, missing ones are
 * created and come first, and common ones not declared are disabled.
 *
 * Every sync-enabled upstream is then synced, and the result is published
 * when anything changed (always with `--publish`, never with `--no-publish`).
 *
 * With `--check`, every entry is then probed as scripts/tvbox-health.ts does
 * and the results applied before publishing, so what a sync brought in that
 * is already dead never goes out. `--json <file>` writes the probe report.
 *
 * Usage:
 *   TVBOX_URL=https://tv.bk.io/mg TVBOX_API_TOKEN=… bun scripts/tvbox-apply.ts [file] [--publish | --no-publish] [--check [--json report.json]]
 *
 * TVBOX_URL is the console's base URL: the origin plus BASE_PATH.
 *
 * The token is a personal API token with the `tvbox:write` scope, created by
 * an admin under Settings → API tokens.
 */
/* eslint-disable no-console */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { applyResults, checkAll, client } from "./tvbox-health";

interface Declared {
  readonly name: string;
  readonly url: string;
  readonly primary?: boolean;
  readonly sync?: boolean;
}

interface Upstream {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly parentId: string | null;
  readonly isPrimary: boolean;
  readonly syncEnabled: boolean;
}

interface Resolver {
  readonly name: string;
  readonly url: string;
}

interface Entry {
  readonly id: string;
  readonly upstreamId: string | null;
  readonly enabled: boolean;
  readonly disabledByHealth: boolean;
  readonly data: Record<string, unknown>;
}

interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly assets: { readonly mirrored: number; readonly failed: readonly string[] };
  readonly lines?: { readonly total: number; readonly failed: readonly string[] };
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonFile = jsonAt === -1 ? undefined : args[jsonAt + 1];
const file = args.find((a, i) => !a.startsWith("--") && (jsonAt === -1 || i !== jsonAt + 1)) ?? "tvbox/upstreams.json";
const publishMode = args.includes("--no-publish") ? "never" : args.includes("--publish") ? "always" : "changed";
const base = process.env.TVBOX_URL?.replace(/\/+$/, "");
const token = process.env.TVBOX_API_TOKEN;

if (!base || !token) {
  console.error("TVBOX_URL and TVBOX_API_TOKEN must be set");
  process.exit(1);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: T }).data;
}

function readDeclared(path: string): Declared[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error(`${path} must be a JSON array of upstreams`);
  const declared = parsed.map((entry, i) => {
    const e = entry as Partial<Declared>;
    if (typeof e.name !== "string" || e.name.trim() === "" || typeof e.url !== "string" || !/^https?:\/\//.test(e.url))
      throw new Error(`${path}[${i}] needs a "name" and an http(s) "url"`);
    return e as Declared;
  });
  if (declared.filter(d => d.primary).length > 1)
    throw new Error(`${path} marks more than one upstream as primary`);
  if (new Set(declared.map(d => d.url)).size !== declared.length)
    throw new Error(`${path} lists the same url twice`);
  return declared;
}

function readResolvers(path: string): Resolver[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error(`${path} must be a JSON array of resolvers`);
  return parsed.map((entry, i) => {
    const e = entry as Partial<Resolver>;
    if (typeof e.name !== "string" || e.name.trim() === "" || typeof e.url !== "string" || !/^https:\/\//.test(e.url))
      throw new Error(`${path}[${i}] needs a "name" and an https "url"`);
    return { name: e.name, url: e.url };
  });
}

/** Make the common DoH entries match the declared resolvers; returns the number of changes. */
async function applyResolvers(resolvers: readonly Resolver[]): Promise<number> {
  const common = (await api<Entry[]>("GET", "/tvbox/entries?kind=doh")).filter(e => e.upstreamId === null);
  let changes = 0;
  const ids: string[] = [];
  for (const r of resolvers) {
    const found = common.find(e => e.data.url === r.url);
    if (!found) {
      ids.push((await api<Entry>("POST", "/tvbox/entries", { kind: "doh", data: { name: r.name, url: r.url } })).id);
      console.log(`doh      created ${r.name}`);
      changes++;
      continue;
    }
    ids.push(found.id);
    // One health disabled stays off until a check passes again.
    const enable = !found.enabled && !found.disabledByHealth;
    if (found.data.name !== r.name || enable) {
      await api("PATCH", `/tvbox/entries/${found.id}`, {
        ...(found.data.name !== r.name ? { data: { ...found.data, name: r.name } } : {}),
        ...(enable ? { enabled: true } : {}),
      });
      console.log(`doh      updated ${r.name}`);
      changes++;
    }
  }
  for (const e of common.filter(e => e.enabled && !resolvers.some(r => r.url === e.data.url))) {
    await api("PATCH", `/tvbox/entries/${e.id}`, { enabled: false });
    console.log(`doh      disabled ${String(e.data.name ?? e.data.url)} (not declared)`);
    changes++;
  }
  const rest = (await api<Entry[]>("GET", "/tvbox/entries?kind=doh")).map(e => e.id).filter(id => !ids.includes(id));
  await api("POST", "/tvbox/entries/reorder", { kind: "doh", ids: [...ids, ...rest] });
  return changes;
}

async function main(): Promise<void> {
  const declared = readDeclared(file);
  const existing = await api<Upstream[]>("GET", "/tvbox/upstreams");
  const ids: { id: string; name: string }[] = [];

  for (const d of declared) {
    const found = existing.find(u => u.parentId === null && u.url === d.url);
    const syncEnabled = d.sync ?? true;
    let id: string;
    let isPrimary: boolean;
    if (!found) {
      const created = await api<Upstream>("POST", "/tvbox/upstreams", { name: d.name, url: d.url, syncEnabled });
      ({ id, isPrimary } = created);
      console.log(`created  ${d.name}`);
    }
    else {
      ({ id, isPrimary } = found);
      const patch = {
        ...(found.name !== d.name ? { name: d.name } : {}),
        ...(found.syncEnabled !== syncEnabled ? { syncEnabled } : {}),
      };
      if (Object.keys(patch).length > 0) {
        await api("PATCH", `/tvbox/upstreams/${id}`, patch);
        console.log(`updated  ${d.name} ${JSON.stringify(patch)}`);
      }
    }
    if (d.primary && !isPrimary) {
      await api("PATCH", `/tvbox/upstreams/${id}`, { isPrimary: true });
      console.log(`primary  ${d.name}`);
    }
    ids.push({ id, name: d.name });
  }

  // A collection's lines are synced with it.
  for (const u of existing.filter(u => u.parentId === null && !declared.some(d => d.url === u.url))) {
    console.log(`kept     ${u.name} (not declared here; manage it in the admin console)`);
    if (u.syncEnabled)
      ids.push({ id: u.id, name: u.name });
  }

  let changed = 0;
  const resolversFile = join(dirname(file), "doh.json");
  if (existsSync(resolversFile))
    changed += await applyResolvers(readResolvers(resolversFile));

  let failed = 0;
  for (const { id, name } of ids) {
    try {
      const r = await api<SyncResult>("POST", `/tvbox/upstreams/${id}/sync`);
      changed += r.added + r.updated + r.removed;
      console.log(`synced   ${name}: +${r.added} ~${r.updated} -${r.removed}, ${r.assets.mirrored} files mirrored${r.lines ? `, ${r.lines.total} lines` : ""}`);
      for (const line of r.lines?.failed ?? [])
        console.log(`         line ${line} failed to sync (see the console)`);
      for (const url of r.assets.failed)
        console.log(`         could not mirror ${url} (previous copy kept)`);
    }
    catch (err) {
      failed++;
      console.error(`failed   ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (args.includes("--check")) {
    console.log("");
    const call = client(base!, token!);
    const results = await checkAll(call);
    if (jsonFile)
      writeFileSync(jsonFile, JSON.stringify(results, null, 2));
    const outcome = await applyResults(call, results);
    changed += outcome.disabled.length + outcome.enabled.length;
  }

  if (publishMode === "always" || (publishMode === "changed" && changed > 0)) {
    const p = await api<{ id: string; counts: string }>("POST", "/tvbox/publishes");
    console.log(`published ${p.id} ${p.counts}`);
  }
  else {
    console.log(publishMode === "never" ? "not published (--no-publish)" : "nothing changed; not published");
  }

  if (failed > 0)
    process.exit(1);
}

try {
  await main();
}
catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
