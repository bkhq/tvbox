import type { SubscriptionBucket } from "./subscription";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { CURRENT_CONFIG_KEY, TOKENS_KEY } from "@/modules/tvbox/storage";
import { handleSubscription } from "./subscription";

const TOKEN = "0123456789abcdef0123456789abcdef";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const JAR_SHA = "c".repeat(64);

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
    [TOKENS_KEY]: JSON.stringify({ hashes: [sha(TOKEN)] }),
    [CURRENT_CONFIG_KEY]: JSON.stringify({ spider: `./a/${JAR_SHA}/spider.jar;md5;x`, sites: [] }),
    [deriveStorageKey(JAR_SHA)]: "PK-jar",
    ...extra,
  });
}

function get(path: string, init?: RequestInit) {
  return new Request(`https://worker.example${path}`, init);
}

describe("subscription access", () => {
  test("an unknown token, a bare prefix or a path escaping the token all look missing", async () => {
    const files = published();
    for (const path of ["/s/wrong/api.json", `/s/${TOKEN}`, "/s/", `/s/${TOKEN}/../api.json`]) {
      const res = await handleSubscription(get(path), { FILES: files });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect(files.reads.filter(k => k !== TOKENS_KEY)).toEqual([]);
  });

  test("nothing is served before the first token exists", async () => {
    const files = bucket({ [CURRENT_CONFIG_KEY]: "{}" });
    expect((await handleSubscription(get(`/s/${TOKEN}/api.json`), { FILES: files })).status).toBe(404);
  });

  test("only reads are allowed, and only once the token matches", async () => {
    expect((await handleSubscription(get(`/s/${TOKEN}/`, { method: "POST" }), { FILES: published() })).status).toBe(405);
    expect((await handleSubscription(get("/s/wrong/", { method: "POST" }), { FILES: published() })).status).toBe(404);
  });
});

describe("subscription content", () => {
  test("the published config is served at the root and at api.json", async () => {
    for (const path of [`/s/${TOKEN}/`, `/s/${TOKEN}/api.json`]) {
      const res = await handleSubscription(get(path), { FILES: published() });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await res.json()).toEqual({ spider: `./a/${JAR_SHA}/spider.jar;md5;x`, sites: [] });
    }
  });

  test("an unpublished config is missing", async () => {
    const files = bucket({ [TOKENS_KEY]: JSON.stringify({ hashes: [sha(TOKEN)] }) });
    expect((await handleSubscription(get(`/s/${TOKEN}/api.json`), { FILES: files })).status).toBe(404);
  });

  test("mirrored files are served by content hash and cached for good", async () => {
    const res = await handleSubscription(get(`/s/${TOKEN}/a/${JAR_SHA}/spider.jar`), { FILES: published() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/java-archive");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("PK-jar");
  });

  test("a malformed or unknown hash is missing", async () => {
    for (const path of [`/s/${TOKEN}/a/xyz/spider.jar`, `/s/${TOKEN}/a/${"d".repeat(64)}/x.json`, `/s/${TOKEN}/other.json`]) {
      const res = await handleSubscription(get(path), { FILES: published() });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });
});
