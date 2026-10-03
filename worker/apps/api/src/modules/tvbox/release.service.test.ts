import type { RegisterReleaseInput } from "./release.service";
import type { UpdateManifest } from "./storage";
import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { deleteRelease, listReleases, registerRelease, updateRelease } from "./release.service";
import { objectExists, putObject, readObjectText, releaseApkKey, updateManifestKey } from "./storage";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
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
    await putObject(releaseApkKey(versionCode, a.mode, a.abi), "apk");
  return await registerRelease(db, { versionCode, versionName: `v${versionCode}`, channel: "stable", notes: "", ...over, assets }, keep);
}

async function manifest(channel: string, mode = "mobile", abi = "arm64_v8a"): Promise<UpdateManifest | null> {
  const key = updateManifestKey(channel, mode, abi);
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
    expect(await objectExists(releaseApkKey(1, "mobile", "arm64_v8a"))).toBe(false);
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
    expect(await objectExists(releaseApkKey(2, "mobile", "arm64_v8a"))).toBe(false);
    expect((await manifest("stable"))?.versionCode).toBe(1);

    const [first] = await listReleases(db);
    await deleteRelease(db, first!.id);
    expect(await manifest("stable")).toBeNull();
  });
});
