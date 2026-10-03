import type { SubscriptionBucket } from "./subscription";
import type { PublishedSnapshot } from "@/modules/tvbox/compose";
import type { DevicesFile } from "@/modules/tvbox/storage";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { DEVICES_KEY, PUBLISHED_KEY } from "@/modules/tvbox/storage";
import { handleSubscription } from "./subscription";

const ALL = "0123456789abcdef0123456789abcdef";
const ONLY_B = "fedcba9876543210fedcba9876543210";
const BOUND = "00112233445566778899aabbccddeeff";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const JAR_SHA = "c".repeat(64);

const snapshot: PublishedSnapshot = {
  version: 2,
  globals: [{ key: "spider", value: `./a/${JAR_SHA}/spider.jar;md5;x` }],
  entries: [
    { id: "1", kind: "sites", upstreamId: "up-a", enabled: true, sort: 0, data: { key: "a" } },
    { id: "2", kind: "sites", upstreamId: "up-b", enabled: true, sort: 1, data: { key: "b" } },
    { id: "3", kind: "sites", upstreamId: null, enabled: true, sort: 2, data: { key: "common" } },
  ],
};

const devices: DevicesFile = {
  devices: {
    [sha(ALL)]: { id: "d1", upstreams: null },
    [sha(ONLY_B)]: { id: "d2", upstreams: ["up-b"] },
    [sha(BOUND)]: { id: "d3", upstreams: null, bindings: [{ id: "app-1", keyHash: sha("key-1") }, { id: "app-2", keyHash: sha("key-2") }] },
  },
};

function bucket(objects: Record<string, string>): SubscriptionBucket & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async get(key: string) {
      reads.push(key);
      const body = objects[key];
      return body === undefined ? null : new Response(body);
    },
  };
}

function published(extra: Record<string, string> = {}) {
  return bucket({
    [DEVICES_KEY]: JSON.stringify(devices),
    [PUBLISHED_KEY]: JSON.stringify(snapshot),
    [deriveStorageKey(JAR_SHA)]: "PK-jar",
    ...extra,
  });
}

const get = (path: string, init?: RequestInit) => new Request(`https://worker.example${path}`, init);
const siteKeys = async (res: Response) => ((await res.json()) as { sites: { key: string }[] }).sites.map(s => s.key);

describe("subscription access", () => {
  test("an unknown token, a bare prefix or a path escaping the token all look missing", async () => {
    const files = published();
    for (const path of ["/s/wrong/api.json", `/s/${ALL}`, "/s/", `/s/${ALL}/../api.json`]) {
      const res = await handleSubscription(get(path), { FILES: files });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    // Only the shared state is read; no mirrored file is touched.
    expect(files.reads.filter(k => k !== DEVICES_KEY && k !== PUBLISHED_KEY)).toEqual([]);
  });

  test("nothing is served before the first device exists", async () => {
    const files = bucket({ [PUBLISHED_KEY]: JSON.stringify(snapshot) });
    expect((await handleSubscription(get(`/s/${ALL}/api.json`), { FILES: files })).status).toBe(404);
  });

  test("only reads are allowed, and only once the token matches", async () => {
    expect((await handleSubscription(get(`/s/${ALL}/`, { method: "POST" }), { FILES: published() })).status).toBe(405);
    expect((await handleSubscription(get("/s/wrong/", { method: "POST" }), { FILES: published() })).status).toBe(404);
  });
});

describe("a device bound to linked apps", () => {
  const as = (id: string, key: string) => ({ headers: { "X-Device-Id": id, "X-Device-Key": key } });

  test("serves its config only to those apps", async () => {
    const files = published();
    expect((await handleSubscription(get(`/s/${BOUND}/api.json`, as("app-1", "key-1")), { FILES: files })).status).toBe(200);
    expect((await handleSubscription(get(`/s/${BOUND}/`, as("app-2", "key-2")), { FILES: files })).status).toBe(200);
    for (const init of [undefined, as("app-1", "key-2"), as("app-3", "key-1"), as("app-1", "")])
      expect((await handleSubscription(get(`/s/${BOUND}/api.json`, init), { FILES: files })).status).toBe(404);
  });

  test("its files stay reachable without the headers", async () => {
    const res = await handleSubscription(get(`/s/${BOUND}/a/${JAR_SHA}/spider.jar`), { FILES: published() });
    expect(res.status).toBe(200);
  });
});

describe("subscription content", () => {
  test("each device gets its upstreams plus the common entries", async () => {
    const all = await handleSubscription(get(`/s/${ALL}/api.json`), { FILES: published() });
    expect(all.status).toBe(200);
    expect(all.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await siteKeys(all)).toEqual(["a", "b", "common"]);

    const onlyB = await handleSubscription(get(`/s/${ONLY_B}/`), { FILES: published() });
    expect(await siteKeys(onlyB)).toEqual(["b", "common"]);
  });

  test("nothing published yet is missing", async () => {
    const files = bucket({ [DEVICES_KEY]: JSON.stringify(devices) });
    expect((await handleSubscription(get(`/s/${ALL}/api.json`), { FILES: files })).status).toBe(404);
  });

  test("mirrored files are served by content hash and cached for good", async () => {
    const res = await handleSubscription(get(`/s/${ALL}/a/${JAR_SHA}/spider.jar`), { FILES: published() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/java-archive");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("PK-jar");

    const image = await handleSubscription(get(`/s/${ALL}/a/${JAR_SHA}/wallpaper.jpg`), { FILES: published() });
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    await image.text();
  });

  test("a malformed or unknown hash is missing", async () => {
    for (const path of [`/s/${ALL}/a/xyz/spider.jar`, `/s/${ALL}/a/${"d".repeat(64)}/x.json`, `/s/${ALL}/other.json`]) {
      const res = await handleSubscription(get(path), { FILES: published() });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });
});
