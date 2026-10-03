#!/usr/bin/env bun
/**
 * Apply the declared TVBox upstreams to a deployment, sync them and publish.
 *
 * Upstreams are matched by URL: a declared one that is missing is created,
 * one whose name or sync flag differs is updated, and `primary: true` makes
 * it the primary. Upstreams added in the admin console but not declared here
 * are left alone (and reported). Every declared upstream is then synced, and
 * the result is published when anything changed (always with `--publish`,
 * never with `--no-publish`).
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
import { readFileSync, writeFileSync } from "node:fs";
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
  readonly isPrimary: boolean;
  readonly syncEnabled: boolean;
}

interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly assets: { readonly mirrored: number; readonly failed: readonly string[] };
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

async function main(): Promise<void> {
  const declared = readDeclared(file);
  const existing = await api<Upstream[]>("GET", "/tvbox/upstreams");
  const ids: { id: string; name: string }[] = [];

  for (const d of declared) {
    const found = existing.find(u => u.url === d.url);
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

  for (const u of existing.filter(u => !declared.some(d => d.url === u.url)))
    console.log(`kept     ${u.name} (not declared here; manage it in the admin console)`);

  let failed = 0;
  let changed = 0;
  for (const { id, name } of ids) {
    try {
      const r = await api<SyncResult>("POST", `/tvbox/upstreams/${id}/sync`);
      changed += r.added + r.updated + r.removed;
      console.log(`synced   ${name}: +${r.added} ~${r.updated} -${r.removed}, ${r.assets.mirrored} files mirrored`);
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
