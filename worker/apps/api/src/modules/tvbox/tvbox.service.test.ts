import type { TokensFile } from "./storage";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { buildConfig, listPublishes, publish, restorePublish } from "./publish.service";
import { CURRENT_CONFIG_KEY, hashHex, readObjectText, TOKENS_KEY } from "./storage";
import { runScheduledSync } from "./sync.job";
import { syncUpstream } from "./sync.service";
import { createToken, deleteToken, updateToken } from "./tokens.service";
import {
  createEntry,
  createUpstream,
  deleteEntry,
  deleteGlobal,
  listEntries,
  listGlobals,
  putGlobal,
  revertEntry,
  updateEntry,
  updateUpstream,
} from "./tvbox.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const noop = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, flush() {} } as unknown as Logger;

const PRIMARY = "https://up.example/xiaosa/api.json";
const SECONDARY = "https://other.example/cfg/api.json";
const JAR = new TextEncoder().encode("PK-spider-v1").buffer;
const JSON_A = new TextEncoder().encode("{\"list\":[1]}").buffer;

let db: AppDatabase;
let dir: string;
let files: Map<string, Response | (() => Response)>;

const fakeFetch = (async (input: RequestInfo | URL) => {
  const hit = files.get(String(input));
  if (!hit)
    return new Response("missing", { status: 404 });
  return typeof hit === "function" ? hit() : hit.clone();
}) as typeof fetch;

function primaryConfig(sites: object[], extra: object = {}) {
  return Response.json({
    spider: "./spider.jar;md5;stale",
    wallpaper: "https://wall.example/",
    sites,
    parses: [{ name: "p1", type: 0, url: "https://parse.example/?url=" }],
    lives: [{}],
    flags: ["qq"],
    ...extra,
  });
}

const SITE_A = { key: "a", name: "A", type: 3, api: "csp_A", ext: { json: "./json/A.json" } };
const SITE_B = { key: "b", name: "B", type: 3, api: "csp_B" };

async function seedAdmin(): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({ id, oauthSub: `sub-${id}`, username: `u-${id}`, name: id, email: `${id}@t.io`, role: "admin", status: "active", createdAt: now, updatedAt: now }).run();
  return id;
}

beforeEach(async () => {
  dir = resolve(tmpdir(), `test-tvbox-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  db = await createDb(resolve(dir, "test.db"));
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  files = new Map<string, Response | (() => Response)>([
    [PRIMARY, primaryConfig([SITE_A, SITE_B])],
    ["https://up.example/xiaosa/spider.jar", new Response(JAR)],
    ["https://up.example/xiaosa/json/A.json", new Response(JSON_A)],
  ]);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function sync(id: string) {
  return await syncUpstream(db, id, { logger: noop, fetch: fakeFetch });
}

describe("importing an upstream", () => {
  test("splits the config into entries and globals, mirroring its files", async () => {
    const up = await createUpstream(db, { name: "xiaosa", url: PRIMARY });
    expect(up.isPrimary).toBe(true);

    const result = await sync(up.id);
    expect(result.assets).toEqual({ mirrored: 2, failed: [] });

    const sites = await listEntries(db, "sites");
    expect(sites.map(s => s.upstreamKey)).toEqual(["a", "b"]);
    const jsonSha = hashHex("sha256", JSON_A);
    expect(sites[0]!.data.ext).toEqual({ json: `./a/${jsonSha}/A.json` });

    const globals = Object.fromEntries((await listGlobals(db)).map(g => [g.key, g.value]));
    expect(globals.spider).toBe(`./a/${hashHex("sha256", JAR)}/spider.jar;md5;${hashHex("md5", JAR)}`);
    expect(globals.flags).toEqual(["qq"]);

    // `lives: [{}]` is not an entry worth keeping, but it is still an entry.
    const config = await buildConfig(db);
    expect(Object.keys(config)).toEqual(["spider", "wallpaper", "sites", "parses", "lives", "flags"]);
  });

  test("a secondary upstream's sites carry its own spider; its globals are ignored", async () => {
    const primary = await createUpstream(db, { name: "p", url: PRIMARY });
    const secondary = await createUpstream(db, { name: "s", url: SECONDARY });
    expect(secondary.isPrimary).toBe(false);
    files.set(SECONDARY, Response.json({ spider: "./s.jar", wallpaper: "https://ignored/", sites: [{ key: "a", name: "A2", type: 3, api: "csp_X" }] }));
    files.set("https://other.example/cfg/s.jar", new Response(new TextEncoder().encode("PK-other").buffer));
    await sync(primary.id);
    await sync(secondary.id);

    const config = await buildConfig(db);
    expect(config.wallpaper).toBe("https://wall.example/");
    const sites = config.sites as { key: string; jar?: string }[];
    expect(sites.map(s => s.key)).toEqual(["a", "b", `a_${secondary.id.slice(0, 6)}`]);
    expect(sites[2]!.jar).toStartWith("./a/");
  });

  test("an unreachable file keeps its previous mirror", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const before = (await listGlobals(db)).find(g => g.key === "spider")!.value;

    files.delete("https://up.example/xiaosa/spider.jar");
    const result = await sync(up.id);
    expect(result.assets.failed).toEqual(["https://up.example/xiaosa/spider.jar"]);
    expect((await listGlobals(db)).find(g => g.key === "spider")!.value).toBe(before);
  });

  test("a broken upstream is recorded on the upstream and reported", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    files.set(PRIMARY, new Response("<html>", { status: 200 }));
    await expect(sync(up.id)).rejects.toThrow("Sync failed");
    const [row] = await (await import("./tvbox.service")).listUpstreams(db);
    expect(row!.lastStatus).toBe("error");
  });
});

describe("re-syncing", () => {
  test("upstream changes follow unless the entry was edited here", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const [a, b] = await listEntries(db, "sites");
    await updateEntry(db, b!.id, { data: { ...b!.data, name: "Mine" } });

    files.set(PRIMARY, primaryConfig([{ ...SITE_A, name: "A v2" }, { ...SITE_B, name: "B v2" }]));
    const result = await sync(up.id);
    expect(result.updated).toBe(1);

    const [a2, b2] = await listEntries(db, "sites");
    expect(a2!.data.name).toBe("A v2");
    expect(b2!.data.name).toBe("Mine");
    expect(b2!.locallyModified).toBe(true);
    expect(b2!.upstreamData!.name).toBe("B v2");

    const reverted = await revertEntry(db, b!.id);
    expect(reverted.data.name).toBe("B v2");
    expect(reverted.locallyModified).toBe(false);
    expect(a!.id).toBe(a2!.id);
  });

  test("an entry the upstream drops is disabled, and comes back when it returns", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);

    files.set(PRIMARY, primaryConfig([SITE_A]));
    expect((await sync(up.id)).removed).toBe(1);
    let b = (await listEntries(db, "sites")).find(s => s.upstreamKey === "b")!;
    expect({ enabled: b.enabled, removed: b.upstreamRemoved }).toEqual({ enabled: false, removed: true });

    files.set(PRIMARY, primaryConfig([SITE_A, SITE_B]));
    await sync(up.id);
    b = (await listEntries(db, "sites")).find(s => s.upstreamKey === "b")!;
    expect({ enabled: b.enabled, removed: b.upstreamRemoved }).toEqual({ enabled: true, removed: false });
  });

  test("an entry disabled by hand stays disabled", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const [a] = await listEntries(db, "sites");
    await updateEntry(db, a!.id, { enabled: false });
    files.set(PRIMARY, primaryConfig([{ ...SITE_A, name: "A v2" }, SITE_B]));
    await sync(up.id);
    expect((await listEntries(db, "sites"))[0]!.enabled).toBe(false);
  });

  test("an overridden global survives a sync", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    await putGlobal(db, "wallpaper", "https://mine/");
    files.set(PRIMARY, primaryConfig([SITE_A, SITE_B], { wallpaper: "https://new-upstream/" }));
    await sync(up.id);
    const wall = (await listGlobals(db)).find(g => g.key === "wallpaper")!;
    expect(wall.value).toBe("https://mine/");
    expect(wall.upstreamValue).toBe("https://new-upstream/");
  });
});

describe("local entries and globals", () => {
  test("can be added and deleted; upstream ones cannot be deleted", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const mine = await createEntry(db, "sites", { key: "mine", name: "Mine", type: 3, api: "csp_M" });
    expect(mine.sort).toBe(2);
    await expect(createEntry(db, "sites", { name: "no key" })).rejects.toThrow("non-empty \"key\"");
    await deleteEntry(db, mine.id);

    const [a] = await listEntries(db, "sites");
    await expect(deleteEntry(db, a!.id)).rejects.toThrow("disable it instead");
    await expect(deleteGlobal(db, "spider")).rejects.toThrow("override the value instead");
    await putGlobal(db, "danmaku", "https://d/");
    await deleteGlobal(db, "danmaku");
  });

  test("making another upstream primary demotes the first", async () => {
    const a = await createUpstream(db, { name: "a", url: PRIMARY });
    const b = await createUpstream(db, { name: "b", url: SECONDARY });
    await updateUpstream(db, b.id, { isPrimary: true });
    const rows = await (await import("./tvbox.service")).listUpstreams(db);
    expect(rows.map(r => [r.id, r.isPrimary])).toEqual([[a.id, false], [b.id, true]]);
  });
});

describe("publishing", () => {
  test("writes the live config and a copy per version; restore republishes an old one", async () => {
    const userId = await seedAdmin();
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const first = await publish(db, { trigger: "manual", userId });
    expect(JSON.parse(first.counts)).toEqual({ sites: 2, parses: 1, lives: 1, rules: 0, doh: 0 });

    const [a] = await listEntries(db, "sites");
    await updateEntry(db, a!.id, { enabled: false });
    await publish(db, { trigger: "manual", userId });
    expect((JSON.parse(await readObjectText(CURRENT_CONFIG_KEY)) as { sites: unknown[] }).sites).toHaveLength(1);

    const restored = await restorePublish(db, first.id, userId);
    expect(restored.restoredFrom).toBe(first.id);
    expect(restored.sha256).toBe(first.sha256);
    expect((JSON.parse(await readObjectText(CURRENT_CONFIG_KEY)) as { sites: unknown[] }).sites).toHaveLength(2);
    expect((await listPublishes(db)).map(p => p.trigger)).toEqual(["restore", "manual", "manual"]);
  });

  test("the scheduled sync publishes only when something changed", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    expect(await runScheduledSync(db, noop, fakeFetch)).toBeGreaterThan(0);
    expect(await runScheduledSync(db, noop, fakeFetch)).toBe(0);
    expect((await listPublishes(db)).map(p => p.trigger)).toEqual(["sync"]);

    await updateUpstream(db, up.id, { syncEnabled: false });
    files.set(PRIMARY, primaryConfig([SITE_A]));
    expect(await runScheduledSync(db, noop, fakeFetch)).toBe(0);
  });
});

describe("subscription tokens", () => {
  test("the Worker's token file lists the hash of every enabled token", async () => {
    const userId = await seedAdmin();
    const one = await createToken(db, "tv", userId);
    const two = await createToken(db, "phone", userId);
    expect(one.token).toMatch(/^[0-9a-f]{32}$/);
    expect(one.row.hint).toBe(one.token.slice(-4));

    const read = async () => (JSON.parse(await readObjectText(TOKENS_KEY)) as TokensFile).hashes;
    expect([...await read()].sort()).toEqual([hashHex("sha256", one.token), hashHex("sha256", two.token)].sort());

    await updateToken(db, one.row.id, { enabled: false });
    expect(await read()).toEqual([hashHex("sha256", two.token)]);
    await deleteToken(db, two.row.id);
    expect(await read()).toEqual([]);
  });
});
