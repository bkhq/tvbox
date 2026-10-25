import type { PublishedSnapshot } from "./compose";
import type { DevicesFile } from "./storage";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { nanoid } from "@/shared/lib/id";
import { composeForDevice } from "./compose";
import { createDevice, deleteDevice, listDevices, rotateDevice, updateDevice } from "./devices.service";
import { buildConfig, listPublishes, publish, restorePublish } from "./publish.service";
import { tvboxPublishes } from "./schema";
import { OWN_JAR, setOwnJar } from "./spider-jar.service";
import { DEVICES_KEY, hashHex, PUBLISHED_KEY, readObjectText } from "./storage";
import { runScheduledSync } from "./sync.job";
import { syncUpstream } from "./sync.service";
import {
  createEntry,
  createUpstream,
  deleteEntries,
  deleteEntry,
  deleteGlobal,
  listEntries,
  listGlobals,
  listUpstreams,
  putGlobal,
  restoreEntry,
  revertEntry,
  setEntriesEnabled,
  updateEntry,
  updateUpstream,
} from "./tvbox.service";
import { storeUpload } from "./upload.service";

const noop = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  flush() {},
} as unknown as Logger;

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
  return typeof hit === "function"
    ? hit()
    : hit.clone();
}) as typeof fetch;

function primaryConfig(sites: object[], extra: object = {}) {
  return Response.json({
    spider: "./spider.jar;md5;stale",
    wallpaper: "https://wall.example/",
    sites,
    parses: [
      { name: "p1", type: 0, url: "https://parse.example/?url=" },
    ],
    lives: [{}],
    flags: ["qq"],
    ...extra,
  });
}

const SITE_A = {
  key: "a",
  name: "A",
  type: 3,
  api: "csp_A",
  ext: { json: "./json/A.json" },
};
const SITE_B = {
  key: "b",
  name: "B",
  type: 3,
  api: "csp_B",
};

async function seedAdmin(): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `u-${id}`,
    name: id,
    email: `${id}@t.io`,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
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
    [
      PRIMARY,
      primaryConfig([SITE_A, SITE_B]),
    ],
    [
      "https://up.example/xiaosa/spider.jar",
      new Response(JAR),
    ],
    [
      "https://up.example/xiaosa/json/A.json",
      new Response(JSON_A),
    ],
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
    expect(Object.keys(config)).toEqual([
      "spider",
      "wallpaper",
      "sites",
      "parses",
      "lives",
      "flags",
    ]);
  });

  test("DoH is ours: an upstream's resolvers are not imported", async () => {
    files.set(PRIMARY, primaryConfig([SITE_A], {
      doh: [
        { name: "Theirs", url: "https://doh.example/dns-query" },
      ],
    }));
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    expect(await listEntries(db, "doh")).toEqual([]);
  });

  test("a secondary upstream's sites carry its own spider; its globals are ignored", async () => {
    const primary = await createUpstream(db, { name: "p", url: PRIMARY });
    const secondary = await createUpstream(db, { name: "s", url: SECONDARY });
    expect(secondary.isPrimary).toBe(false);
    files.set(SECONDARY, Response.json({
      spider: "./s.jar",
      wallpaper: "https://ignored/",
      sites: [
        {
          key: "a",
          name: "A2",
          type: 3,
          api: "csp_X",
        },
      ],
    }));
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

describe("collections", () => {
  const COLLECTION = "https://list.example/op.json";
  const LINE_B = "https://b.example/tv.json";

  beforeEach(() => {
    // Line comments and a relative line, as collections in the wild have them.
    files.set(COLLECTION, new Response(`// collected lines\n{"urls": [
      {"url": "${SECONDARY}", "name": "Other"},
      {"url": "./b/../tv.json", "name": "Relative"},
      {"url": "clan://localhost/x.json", "name": "Local only"}
    ]}`));
    files.set(SECONDARY, Response.json({
      spider: "./s.jar",
      sites: [
        {
          key: "a",
          name: "A2",
          type: 3,
          api: "csp_X",
        },
      ],
    }));
    files.set("https://other.example/cfg/s.jar", new Response(new TextEncoder().encode("PK-other").buffer));
  });

  test("each line becomes an upstream of its own, synced with its own spider", async () => {
    files.set("https://list.example/tv.json", Response.json({
      sites: [
        {
          key: "c",
          name: "C",
          type: 1,
          api: "https://cms.example/api",
        },
      ],
    }));
    const primary = await createUpstream(db, { name: "p", url: PRIMARY });
    await sync(primary.id);
    const list = await createUpstream(db, { name: "op", url: COLLECTION });

    const result = await sync(list.id);
    expect(result.lines).toEqual({ total: 2, failed: [] });
    expect(result.added).toBe(2);

    const lines = (await listUpstreams(db)).filter(u => u.parentId === list.id);
    expect(lines.map(u => [u.name, u.url, u.isPrimary])).toEqual([
      ["Other", SECONDARY, false],
      ["Relative", "https://list.example/tv.json", false],
    ]);
    expect((await listEntries(db, "sites", list.id))).toEqual([]);
    const other = (await listEntries(db, "sites", lines[0]!.id))[0]!;
    expect(other.data.jar).toStartWith("./a/");
  });

  test("a dropped line goes with its entries; a line switched off is not synced; one that fails is reported", async () => {
    const list = await createUpstream(db, { name: "op", url: COLLECTION });
    const first = await sync(list.id);
    expect(first.lines!.failed).toEqual(["Relative"]);
    const lines = (await listUpstreams(db)).filter(u => u.parentId === list.id);
    expect(lines.find(u => u.name === "Relative")!.lastStatus).toBe("error");

    const other = lines.find(u => u.name === "Other")!;
    await updateUpstream(db, other.id, { syncEnabled: false, name: "Mine" });
    files.set(SECONDARY, Response.json({ sites: [] }));
    const second = await sync(list.id);
    expect(second.lines!.total).toBe(2);
    expect(await listEntries(db, "sites", other.id)).toHaveLength(1);
    expect((await listUpstreams(db)).find(u => u.id === other.id)!.name).toBe("Mine");

    files.set(COLLECTION, Response.json({
      urls: [
        { url: LINE_B, name: "B" },
      ],
    }));
    files.set(LINE_B, Response.json({ sites: [] }));
    const third = await sync(list.id);
    expect(third.removed).toBeGreaterThan(0);
    expect((await listUpstreams(db)).filter(u => u.parentId === list.id).map(u => u.name)).toEqual(["B"]);
    expect(await listEntries(db, "sites", other.id)).toEqual([]);
  });

  test("a line that is itself a collection is refused", async () => {
    files.set(SECONDARY, Response.json({
      urls: [
        { url: PRIMARY, name: "deeper" },
      ],
    }));
    const list = await createUpstream(db, { name: "op", url: COLLECTION });
    expect((await sync(list.id)).lines!.failed).toContain("Other");
    const other = (await listUpstreams(db)).find(u => u.name === "Other")!;
    expect(other.lastError).toContain("collection");
  });

  test("a device that follows a collection follows every line, including new ones", async () => {
    const userId = await seedAdmin();
    const list = await createUpstream(db, { name: "op", url: COLLECTION });
    const dev = await createDevice(db, {
      name: "tv",
      upstreamIds: [list.id],
    }, userId);
    await sync(list.id);
    const lines = (await listUpstreams(db)).filter(u => u.parentId === list.id).map(u => u.id);
    const file = (JSON.parse(await readObjectText(DEVICES_KEY)) as DevicesFile).devices;
    expect(file[hashHex("sha256", dev.token!)]!.upstreams).toEqual([list.id, ...lines]);

    // Deleting the collection deletes its lines.
    await (await import("./tvbox.service")).deleteUpstream(db, list.id);
    expect(await listUpstreams(db)).toEqual([]);
  });
});

describe("re-syncing", () => {
  test("upstream changes follow unless the entry was edited here", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const [a, b] = await listEntries(db, "sites");
    await updateEntry(db, b!.id, {
      data: { ...b!.data, name: "Mine" },
    });

    files.set(PRIMARY, primaryConfig([
      { ...SITE_A, name: "A v2" },
      { ...SITE_B, name: "B v2" },
    ]));
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
    files.set(PRIMARY, primaryConfig([
      { ...SITE_A, name: "A v2" },
      SITE_B,
    ]));
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
  test("local entries can be added and deleted; upstream globals cannot be deleted", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const mine = await createEntry(db, "sites", {
      key: "mine",
      name: "Mine",
      type: 3,
      api: "csp_M",
    });
    expect(mine.sort).toBe(2);
    await expect(createEntry(db, "sites", { name: "no key" })).rejects.toThrow("non-empty \"key\"");
    await deleteEntry(db, mine.id);
    expect(await listEntries(db, "sites", undefined, true)).toEqual([]);

    await expect(deleteGlobal(db, "spider")).rejects.toThrow("override the value instead");
    await putGlobal(db, "danmaku", "https://d/");
    await deleteGlobal(db, "danmaku");
  });

  test("a deleted upstream entry stays deleted through syncs until restored", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const [a] = await listEntries(db, "sites");
    await deleteEntry(db, a!.id);
    expect((await listEntries(db, "sites")).map(e => e.upstreamKey)).toEqual(["b"]);
    expect((await listEntries(db, "sites", undefined, true)).map(e => e.upstreamKey)).toEqual(["a"]);
    expect((await buildConfig(db)).sites).toEqual([SITE_B]);

    // The upstream changes it, drops it, brings it back: still deleted.
    files.set(PRIMARY, primaryConfig([
      { ...SITE_A, name: "A!" },
      SITE_B,
    ]));
    expect((await sync(up.id)).updated).toBe(0);
    files.set(PRIMARY, primaryConfig([SITE_B]));
    expect((await sync(up.id)).removed).toBe(0);
    files.set(PRIMARY, primaryConfig([SITE_A, SITE_B]));
    await sync(up.id);
    expect((await listEntries(db, "sites")).map(e => e.upstreamKey)).toEqual(["b"]);

    const restored = await restoreEntry(db, a!.id);
    expect(restored).toMatchObject({ deleted: false, enabled: true });
    expect((await buildConfig(db)).sites).toHaveLength(2);
    await expect(restoreEntry(db, a!.id)).rejects.toThrow("not deleted");
  });

  test("bulk delete removes local entries and hides upstream ones", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const mine = await createEntry(db, "sites", {
      key: "mine",
      name: "Mine",
      type: 3,
      api: "csp_M",
    });
    const ids = (await listEntries(db, "sites")).map(e => e.id);
    expect(await deleteEntries(db, ids)).toBe(3);
    expect(await listEntries(db, "sites")).toEqual([]);
    expect((await listEntries(db, "sites", undefined, true)).map(e => e.id)).not.toContain(mine.id);
  });

  test("making another upstream primary demotes the first", async () => {
    const a = await createUpstream(db, { name: "a", url: PRIMARY });
    const b = await createUpstream(db, { name: "b", url: SECONDARY });
    await updateUpstream(db, b.id, { isPrimary: true });
    const rows = await (await import("./tvbox.service")).listUpstreams(db);
    expect(rows.map(r => [r.id, r.isPrimary])).toEqual([
      [a.id, false],
      [b.id, true],
    ]);
  });
});

async function liveSiteCount(): Promise<number> {
  const snapshot = JSON.parse(await readObjectText(PUBLISHED_KEY)) as PublishedSnapshot;
  return (composeForDevice(snapshot, null).sites as unknown[]).length;
}

describe("publishing", () => {
  test("writes the live config and a copy per version; restore republishes an old one", async () => {
    const userId = await seedAdmin();
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const first = await publish(db, { trigger: "manual", userId });
    expect(JSON.parse(first.counts)).toEqual({
      sites: 2,
      parses: 1,
      lives: 1,
      rules: 0,
      doh: 0,
    });

    const [a] = await listEntries(db, "sites");
    await updateEntry(db, a!.id, { enabled: false });
    await publish(db, { trigger: "manual", userId });
    expect(await liveSiteCount()).toBe(1);

    const restored = await restorePublish(db, first.id, userId);
    expect(restored.restoredFrom).toBe(first.id);
    expect(restored.sha256).toBe(first.sha256);
    expect(await liveSiteCount()).toBe(2);
    expect((await listPublishes(db)).map(p => p.trigger)).toEqual(["restore", "manual", "manual"]);
  });

  test("a version published before devices cannot be restored", async () => {
    const userId = await seedAdmin();
    await db.insert(tvboxPublishes).values({
      id: "legacy",
      sha256: "x",
      size: 1,
      counts: "{}",
      trigger: "manual",
    }).run();
    await expect(restorePublish(db, "legacy", userId)).rejects.toThrow("predates devices");
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

describe("devices", () => {
  const readDevices = async () => (JSON.parse(await readObjectText(DEVICES_KEY)) as DevicesFile).devices;

  test("each device gets a viewable URL; the Worker's file maps its hash to its upstreams", async () => {
    const userId = await seedAdmin();
    const a = await createUpstream(db, { name: "a", url: PRIMARY });
    const tv = await createDevice(db, { name: "tv", upstreamIds: null }, userId);
    const phone = await createDevice(db, {
      name: "phone",
      upstreamIds: [a.id],
    }, userId);
    expect(tv.token).toMatch(/^[0-9a-f]{32}$/);
    expect(tv.hint).toBe(tv.token!.slice(-4));

    expect(await readDevices()).toEqual({
      [hashHex("sha256", tv.token!)]: { id: tv.id, upstreams: null },
      [hashHex("sha256", phone.token!)]: {
        id: phone.id,
        upstreams: [a.id],
      },
    });
    expect((await listUpstreams(db))[0]).toMatchObject({ deviceCount: 1 });
  });

  test("changing upstreams, rotating, disabling and deleting rewrite the file", async () => {
    const userId = await seedAdmin();
    const a = await createUpstream(db, { name: "a", url: PRIMARY });
    const b = await createUpstream(db, { name: "b", url: SECONDARY });
    const dev = await createDevice(db, { name: "tv", upstreamIds: null }, userId);

    const narrowed = await updateDevice(db, dev.id, {
      upstreamIds: [b.id],
    });
    expect({ all: narrowed.allUpstreams, ids: narrowed.upstreamIds }).toEqual({
      all: false,
      ids: [b.id],
    });
    expect(Object.values(await readDevices())).toEqual([
      {
        id: dev.id,
        upstreams: [b.id],
      },
    ]);

    const rotated = await rotateDevice(db, dev.id);
    expect(rotated.token).not.toBe(dev.token);
    expect(Object.keys(await readDevices())).toEqual([
      hashHex("sha256", rotated.token!),
    ]);

    await updateDevice(db, dev.id, { enabled: false });
    expect(await readDevices()).toEqual({});
    await updateDevice(db, dev.id, { enabled: true });

    // Deleting an upstream drops it from every device that picked it.
    await (await import("./tvbox.service")).deleteUpstream(db, b.id);
    expect(Object.values(await readDevices())).toEqual([
      { id: dev.id, upstreams: [] },
    ]);
    expect(a.id).toBeTruthy();

    await deleteDevice(db, dev.id);
    expect(await listDevices(db)).toEqual([]);
    expect(await readDevices()).toEqual({});
  });

  test("an unknown upstream is refused and nothing is created", async () => {
    const userId = await seedAdmin();
    await expect(createDevice(db, {
      name: "tv",
      upstreamIds: ["nope"],
    }, userId)).rejects.toThrow("Unknown upstream");
    expect(await listDevices(db)).toEqual([]);
  });
});

describe("content management", () => {
  test("entries filter by source, and enable or disable in bulk", async () => {
    const up = await createUpstream(db, { name: "x", url: PRIMARY });
    await sync(up.id);
    const common = await createEntry(db, "sites", {
      key: "mine",
      name: "Mine",
      type: 3,
      api: "csp_M",
    });

    expect((await listEntries(db, "sites", "common")).map(e => e.id)).toEqual([common.id]);
    expect((await listEntries(db, "sites", up.id)).map(e => e.upstreamKey)).toEqual(["a", "b"]);

    const ids = (await listEntries(db, "sites")).map(e => e.id);
    expect(await setEntriesEnabled(db, ids, false)).toBe(3);
    expect((await listEntries(db, "sites")).every(e => !e.enabled)).toBe(true);
    expect((await listUpstreams(db))[0]).toMatchObject({ entryCount: 4 });
  });
});

describe("our own spider jar", () => {
  test("a site whose jar is @tvbox gets the jar uploaded last", async () => {
    await createEntry(db, "sites", {
      key: "cms",
      name: "CMS",
      type: 3,
      api: "csp_MacCms",
      jar: OWN_JAR,
      ext: "https://cms.example/api.php/provide/vod/",
    });
    const v1 = new TextEncoder().encode("PK-tvbox-1").buffer;
    expect(await setOwnJar(db, v1)).toMatchObject({
      changed: true,
      md5: hashHex("md5", v1),
    });
    expect(await setOwnJar(db, v1)).toMatchObject({ changed: false });
    const site = () => buildConfig(db).then(c => (c.sites as { jar: string }[])[0]!);
    expect((await site()).jar).toBe(`./a/${hashHex("sha256", v1)}/tvbox.jar;md5;${hashHex("md5", v1)}`);

    const v2 = new TextEncoder().encode("PK-tvbox-2").buffer;
    expect((await setOwnJar(db, v2)).changed).toBe(true);
    expect((await site()).jar).toStartWith(`./a/${hashHex("sha256", v2)}/`);
    // The entry itself keeps the marker.
    expect((await listEntries(db, "sites"))[0]!.data.jar).toBe(OWN_JAR);
  });
});

describe("uploads", () => {
  test("store a file by content hash and hand back the path a config uses", async () => {
    const bytes = new TextEncoder().encode("PNG-bytes").buffer;
    const first = await storeUpload(db, "My Logo.png", bytes);
    const sha = hashHex("sha256", bytes);
    expect(first).toEqual({
      path: `./a/${sha}/My_Logo.png`,
      name: "My_Logo.png",
      sha256: sha,
      md5: hashHex("md5", bytes),
      size: 9,
    });
    expect(await readObjectText((await import("@/modules/file/storage/key")).deriveStorageKey(sha))).toBe("PNG-bytes");
    // The same bytes again are stored once.
    expect((await storeUpload(db, "My Logo.png", bytes)).sha256).toBe(sha);
  });

  test("refuse an empty or oversized file", async () => {
    await expect(storeUpload(db, "x.png", new ArrayBuffer(0))).rejects.toThrow("empty");
    await expect(storeUpload(db, "x.png", new ArrayBuffer(20 * 1024 * 1024 + 1))).rejects.toThrow("larger");
  });
});
