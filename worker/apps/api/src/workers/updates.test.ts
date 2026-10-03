import type { SubscriptionBucket } from "./subscription";
import { describe, expect, test } from "bun:test";
import { releaseApkKey, updateManifestKey } from "@/modules/tvbox/storage";
import { handleUpdates } from "./updates";

function bucket(objects: Record<string, string>): SubscriptionBucket {
  return {
    async get(key: string) {
      const body = objects[key];
      return body === undefined ? null : Object.assign(new Response(body), { size: body.length });
    },
  };
}

const FILES = bucket({
  [updateManifestKey("stable", "mobile", "arm64_v8a")]: "{\"versionCode\":10203}",
  [releaseApkKey(10203, "mobile", "arm64_v8a")]: "APK-BYTES",
});

const get = (path: string, init?: RequestInit) => new Request(`https://worker.example${path}`, init);

describe("update endpoints", () => {
  test("serve the manifest of a channel and flavor", async () => {
    const res = await handleUpdates(get("/u/stable/mobile-arm64_v8a.json"), { FILES });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ versionCode: 10203 });
  });

  test("serve the APK with its length", async () => {
    const res = await handleUpdates(get("/u/apk/10203/mobile-arm64_v8a.apk"), { FILES });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(res.headers.get("content-length")).toBe("9");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename=\"tvbox-10203-mobile-arm64_v8a.apk\"");
    expect(await res.text()).toBe("APK-BYTES");
  });

  test("anything unknown or malformed is missing, and only reads are allowed", async () => {
    for (const path of ["/u/stable/mobile-x86.json", "/u/nightly/mobile-arm64_v8a.json", "/u/apk/abc/mobile-arm64_v8a.apk", "/u/apk/10203/../x.apk", "/u/"]) {
      const res = await handleUpdates(get(path), { FILES });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect((await handleUpdates(get("/u/stable/mobile-arm64_v8a.json", { method: "POST" }), { FILES })).status).toBe(405);
  });
});
