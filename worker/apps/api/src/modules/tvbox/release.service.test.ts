import type { RegisterReleaseInput } from "./release.service";
import type { UpdateManifest } from "./storage";
import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDb } from "@/db";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { nanoid } from "@/shared/lib/id";
import { deleteRelease, listReleases, registerRelease, updateRelease } from "./release.service";
import { MANIFEST_INDEX_KEY, manifestIndexKey, objectExists, putObject, readObjectText, releaseFileKey, updateManifestKey } from "./storage";

const SHA = "e".repeat(64);

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = resolve(tmpdir(), `test-release-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  db = await createDb(resolve(dir, "test.db"));
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const FLAVORS = [["leanback", "arm64_v8a"], ["mobile", "arm64_v8a"]] as const;

async function release(versionCode: number, over: Partial<RegisterReleaseInput> = {}, keep = 10) {
  const assets = over.assets ?? FLAVORS.map(([mode, abi]) => ({ mode, abi, sha256: SHA, size: 100 }));
  for (const a of assets)
    await putObject(releaseFileKey(versionCode, a.mode, a.abi, over.app), "bin");
  return await registerRelease(db, { versionCode, versionName: `v${versionCode}`, channel: "stable", notes: "", ...over, assets }, keep);
}

async function manifest(channel: string, mode = "mobile", abi = "arm64_v8a", app: "tvbox" | "rn" = "tvbox"): Promise<UpdateManifest | null> {
  const key = updateManifestKey(channel, mode, abi, app);
  return (await objectExists(key)) ? JSON.parse(await readObjectText(key)) as UpdateManifest : null;
}

describe("registering a release", () => {
  test("publishes a manifest per flavor and channel pointing at the APK", async () => {
    await release(10203, { notes: "fixes" });
    expect(await manifest("stable")).toMatchObject({
      versionCode: 10203,
      versionName: "v10203",
      notes: "fixes",
      url: "../apk/10203/mobile-arm64_v8a.apk",
      sha256: SHA,
      size: 100,
    });
    expect((await manifest("beta"))?.versionCode).toBe(10203);
    expect((await manifest("stable", "leanback"))?.versionCode).toBe(10203);
  });

  test("refuses a flavor whose APK was not uploaded", async () => {
    await expect(registerRelease(db, {
      versionCode: 1,
      versionName: "v1",
      channel: "stable",
      notes: "",
      assets: [{ mode: "mobile", abi: "x86", sha256: SHA, size: 1 }],
    }, 10)).rejects.toThrow("No APK uploaded for mobile-x86");
  });

  test("re-registering a version replaces it", async () => {
    await release(5);
    await release(5, { notes: "again", assets: [{ mode: "mobile", abi: "arm64_v8a", sha256: SHA, size: 7 }] });
    const all = await listReleases(db);
    expect(all).toHaveLength(1);
    expect(all[0]!.assets).toHaveLength(1);
    expect((await manifest("stable"))?.size).toBe(7);
    // The leanback flavor lost its release, so it loses its manifest.
    expect(await manifest("stable", "leanback")).toBeNull();
  });

  test("beta clients get the newer of beta and stable; stable clients never see beta", async () => {
    await release(1);
    await release(2, { channel: "beta" });
    expect((await manifest("stable"))?.versionCode).toBe(1);
    expect((await manifest("beta"))?.versionCode).toBe(2);
    await release(3);
    expect((await manifest("beta"))?.versionCode).toBe(3);
  });

  test("only the newest `keep` releases are kept, with their APKs", async () => {
    await release(1, {}, 2);
    await release(2, {}, 2);
    await release(3, {}, 2);
    expect((await listReleases(db)).map(r => r.versionCode)).toEqual([3, 2]);
    expect(await objectExists(releaseFileKey(1, "mobile", "arm64_v8a"))).toBe(false);
  });
});

describe("the rn app", () => {
  const RN = { app: "rn", assets: [
    { mode: "android", abi: "universal", sha256: SHA, size: 10 },
    { mode: "ios", abi: "universal", sha256: SHA, size: 20, bundleId: "io.bk.tv" },
  ] } as const;

  test("has its own manifests, pointing at the APK or the ipa", async () => {
    await release(10000, RN);
    expect(await manifest("stable", "android", "universal", "rn")).toMatchObject({ url: "../apk/10000/android-universal.apk", size: 10 });
    const ios = await manifest("stable", "ios", "universal", "rn");
    expect(ios).toMatchObject({ versionCode: 10000, url: "../ipa/10000/ios-universal.ipa", size: 20, bundleId: "io.bk.tv" });
    expect(await manifest("stable", "android", "universal")).toBeNull();
    expect(JSON.parse(await readObjectText(manifestIndexKey("rn")))).toHaveLength(4);
    expect(await objectExists(MANIFEST_INDEX_KEY)).toBe(false);
  });

  test("neither replaces nor prunes a tvbox release with the same version code", async () => {
    await release(10000);
    await release(10000, RN, 1);
    await release(10001, RN, 1);
    expect((await listReleases(db)).map(r => [r.app, r.versionCode])).toEqual([["rn", 10001], ["tvbox", 10000]]);
    expect(await objectExists(releaseFileKey(10000, "mobile", "arm64_v8a"))).toBe(true);
    expect(await objectExists(releaseFileKey(10000, "ios", "universal", "rn"))).toBe(false);
    expect((await manifest("stable"))?.versionCode).toBe(10000);
    expect((await manifest("stable", "ios", "universal", "rn"))?.versionCode).toBe(10001);

    const [rn] = await listReleases(db);
    await deleteRelease(db, rn!.id);
    expect(await manifest("stable", "ios", "universal", "rn")).toBeNull();
    expect((await manifest("stable"))?.versionCode).toBe(10000);
  });

  test("refuses an ipa flavor without a bundle id", async () => {
    await expect(release(10000, { app: "rn", assets: [{ mode: "tvos", abi: "universal", sha256: SHA, size: 1 }] }))
      .rejects
      .toMatchObject({ statusCode: 422, message: "No bundle id for tvos-universal" });
  });
});

describe("managing releases", () => {
  test("withdrawing falls back to the previous release; deleting removes the APKs", async () => {
    await release(1);
    const second = await release(2);
    await updateRelease(db, second.id, { withdrawn: true });
    expect((await manifest("stable"))?.versionCode).toBe(1);

    await updateRelease(db, second.id, { withdrawn: false });
    expect((await manifest("stable"))?.versionCode).toBe(2);

    await deleteRelease(db, second.id);
    expect(await objectExists(releaseFileKey(2, "mobile", "arm64_v8a"))).toBe(false);
    expect((await manifest("stable"))?.versionCode).toBe(1);

    const [first] = await listReleases(db);
    await deleteRelease(db, first!.id);
    expect(await manifest("stable")).toBeNull();
  });
});
