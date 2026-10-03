import type { SubscriptionBucket } from "./subscription";
import type { UpdateManifest } from "@/modules/tvbox/storage";
import { describe, expect, test } from "bun:test";
import { MANIFEST_INDEX_KEY, updateManifestKey } from "@/modules/tvbox/storage";
import { handleLanding } from "./landing";

function manifest(over: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    versionCode: 10203,
    versionName: "1.2.3",
    notes: "",
    url: "../apk/10203/mobile-arm64_v8a.apk",
    sha256: "e".repeat(64),
    size: 57 * 1024 * 1024,
    createdAt: "2026-10-03T16:00:00.000Z",
    ...over,
  };
}

function bucket(objects: Record<string, string>): SubscriptionBucket {
  return {
    async get(key: string) {
      const body = objects[key];
      return body === undefined ? null : new Response(body);
    },
  };
}

const keys = [
  updateManifestKey("stable", "mobile", "arm64_v8a"),
  updateManifestKey("stable", "leanback", "armeabi_v7a"),
  updateManifestKey("beta", "mobile", "arm64_v8a"),
];

const FILES = bucket({
  [MANIFEST_INDEX_KEY]: JSON.stringify(keys),
  [keys[0]!]: JSON.stringify(manifest({ notes: "修复 <script>alert(1)</script>" })),
  [keys[1]!]: JSON.stringify(manifest({ url: "../apk/10203/leanback-armeabi_v7a.apk", size: 50 * 1024 * 1024 })),
  [keys[2]!]: JSON.stringify(manifest({ versionCode: 10300, versionName: "1.3.0-beta" })),
});

const get = (init?: RequestInit) => new Request("https://tv.example/", init);

describe("download page", () => {
  test("lists the stable APK of every flavor, TV builds first, with download links", async () => {
    const res = await handleLanding(get(), { FILES });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();

    expect(html).toContain("电视版");
    expect(html).toContain("手机版");
    expect(html.indexOf("电视版")).toBeLessThan(html.indexOf("手机版"));
    expect(html).toContain("href=\"/u/apk/10203/leanback-armeabi_v7a.apk\"");
    expect(html).toContain("href=\"/u/apk/10203/mobile-arm64_v8a.apk\"");
    expect(html).toContain("57.0 MB");
    expect(html).not.toContain("1.3.0-beta");
  });

  test("shows only the newest release; a flavor it does not ship is left out", async () => {
    const files = bucket({
      [MANIFEST_INDEX_KEY]: JSON.stringify(keys.slice(0, 2)),
      [keys[0]!]: JSON.stringify(manifest({ versionCode: 10300, versionName: "1.3.0", url: "../apk/10300/mobile-arm64_v8a.apk" })),
      [keys[1]!]: JSON.stringify(manifest({ url: "../apk/10203/leanback-armeabi_v7a.apk" })),
    });
    const html = await (await handleLanding(get(), { FILES: files })).text();
    expect(html).toContain("1.3.0");
    expect(html).toContain("href=\"/u/apk/10300/mobile-arm64_v8a.apk\"");
    expect(html).not.toContain("1.2.3");
    expect(html).not.toContain("电视版");
  });

  test("escapes release notes", async () => {
    const html = await (await handleLanding(get(), { FILES })).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("says so when nothing is released yet", async () => {
    const html = await (await handleLanding(get(), { FILES: bucket({}) })).text();
    expect(html).toContain("暂无可下载的版本");
  });

  test("only reads are allowed", async () => {
    expect((await handleLanding(get({ method: "POST" }), { FILES })).status).toBe(405);
  });
});
