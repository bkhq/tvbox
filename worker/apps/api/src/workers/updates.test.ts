import type { SubscriptionBucket } from "./subscription";
import { describe, expect, test } from "bun:test";
import { releaseFileKey, updateManifestKey } from "@/modules/tvbox/storage";
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
  [releaseFileKey(10203, "mobile", "arm64_v8a")]: "APK-BYTES",
  [updateManifestKey("stable", "android", "universal", "rn")]: "{\"versionCode\":10000,\"url\":\"../apk/10000/android-universal.apk\"}",
  [updateManifestKey("stable", "ios", "universal", "rn")]: JSON.stringify({
    versionCode: 10000,
    versionName: "1.0.0",
    url: "../ipa/10000/ios-universal.ipa",
    bundleId: "io.bk.<tv>&\"x'",
  }),
  [releaseFileKey(10000, "android", "universal", "rn")]: "RN-APK",
  [releaseFileKey(10000, "ios", "universal", "rn")]: "RN-IPA",
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

  test("serve the rn manifest and binaries apart from the Java ones", async () => {
    const json = await handleUpdates(get("/u/rn/stable/android-universal.json"), { FILES });
    expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await json.json()).toEqual({ versionCode: 10000, url: "../apk/10000/android-universal.apk" });

    const apk = await handleUpdates(get("/u/rn/apk/10000/android-universal.apk"), { FILES });
    expect(apk.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(apk.headers.get("content-disposition")).toBe("attachment; filename=\"rn-10000-android-universal.apk\"");
    expect(await apk.text()).toBe("RN-APK");

    const ipa = await handleUpdates(get("/u/rn/ipa/10000/ios-universal.ipa"), { FILES });
    expect(ipa.headers.get("content-type")).toBe("application/octet-stream");
    expect(ipa.headers.get("content-length")).toBe("6");
    expect(await ipa.text()).toBe("RN-IPA");
  });

  test("serve the itms-services manifest of an ipa flavor", async () => {
    const res = await handleUpdates(get("/u/rn/stable/ios-universal.plist"), { FILES });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<key>kind</key><string>software-package</string>");
    expect(body).toContain("<key>url</key><string>https://worker.example/u/rn/ipa/10000/ios-universal.ipa</string>");
    expect(body).toContain("<key>bundle-identifier</key><string>io.bk.&#60;tv&#62;&#38;&#34;x&#39;</string>");
    expect(body).toContain("<key>bundle-version</key><string>1.0.0</string>");
    expect(body).toContain("<key>kind</key><string>software</string>");
    expect(body).toContain("<key>title</key><string>影视</string>");
  });

  test("anything unknown or malformed is missing, and only reads are allowed", async () => {
    for (const path of ["/u/stable/mobile-x86.json", "/u/nightly/mobile-arm64_v8a.json", "/u/apk/abc/mobile-arm64_v8a.apk", "/u/apk/10203/../x.apk", "/u/",
    // The rn channel: no Java keys, no plist for an APK flavor, kind and
    // extension must agree with the mode.
      "/u/rn/stable/mobile-arm64_v8a.json", "/u/rn/apk/10203/mobile-arm64_v8a.apk", "/u/rn/stable/android-universal.plist", "/u/rn/beta/ios-universal.plist", "/u/rn/ipa/10000/android-universal.ipa", "/u/rn/apk/10000/ios-universal.apk", "/u/rn/apk/10000/android-universal.ipa", "/u/rn/ipa/10000/ios-universal.apk", "/u/rn/nightly/ios-universal.plist", "/u/rn/ipa/10000/../ios-universal.ipa", "/u/rn/", "/u/stable/android-universal.json"]) {
      const res = await handleUpdates(get(path), { FILES });
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect((await handleUpdates(get("/u/stable/mobile-arm64_v8a.json", { method: "POST" }), { FILES })).status).toBe(405);
  });
});
