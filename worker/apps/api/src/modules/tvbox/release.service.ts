import type { UpdateManifest } from "./storage";
import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { tvboxReleaseAssets, tvboxReleases } from "./schema";
import { deleteObject, objectExists, putObject, readObjectText, releaseApkKey, updateManifestKey } from "./storage";

export const CHANNELS = ["stable", "beta"] as const;
export type Channel = typeof CHANNELS[number];

type ReleaseRow = typeof tvboxReleases.$inferSelect;
type AssetRow = typeof tvboxReleaseAssets.$inferSelect;
export interface ReleaseView extends ReleaseRow {
  readonly assets: readonly AssetRow[];
}

export interface RegisterReleaseInput {
  readonly versionCode: number;
  readonly versionName: string;
  readonly channel: Channel;
  readonly notes: string;
  readonly assets: readonly { readonly mode: string; readonly abi: string; readonly sha256: string; readonly size: number }[];
}

// Manifests written last time, so a flavor that no longer has a release
// loses its manifest instead of offering a deleted APK.
const MANIFEST_INDEX_KEY = "tvbox/updates/index.json";

export async function listReleases(db: AppDatabase): Promise<ReleaseView[]> {
  const releases = await db.select().from(tvboxReleases).orderBy(desc(tvboxReleases.versionCode)).all();
  const assets = await db.select().from(tvboxReleaseAssets).all();
  return releases.map(r => ({ ...r, assets: assets.filter(a => a.releaseId === r.id) }));
}

async function getRelease(db: AppDatabase, id: string): Promise<ReleaseView> {
  const release = (await listReleases(db)).find(r => r.id === id);
  if (!release)
    throw new NotFoundError("Release");
  return release;
}

/**
 * Register what CI uploaded. Re-registering a version replaces it, so a
 * re-run of the release job is harmless. Older releases beyond `keep` are
 * deleted with their APKs.
 */
export async function registerRelease(db: AppDatabase, input: RegisterReleaseInput, keep: number): Promise<ReleaseView> {
  for (const asset of input.assets) {
    if (!(await objectExists(releaseApkKey(input.versionCode, asset.mode, asset.abi))))
      throw new AppError(`No APK uploaded for ${asset.mode}-${asset.abi}`, 422, "APK_MISSING");
  }

  const existing = await db.select().from(tvboxReleases).where(eq(tvboxReleases.versionCode, input.versionCode)).get();
  const id = existing?.id ?? ulid();
  await db.transaction(async (tx) => {
    const fields = { versionName: input.versionName, channel: input.channel, notes: input.notes, withdrawn: false };
    if (existing) {
      await tx.update(tvboxReleases).set(fields).where(eq(tvboxReleases.id, id)).run();
      await tx.delete(tvboxReleaseAssets).where(eq(tvboxReleaseAssets.releaseId, id)).run();
    }
    else {
      await tx.insert(tvboxReleases).values({ id, versionCode: input.versionCode, ...fields }).run();
    }
    for (const asset of input.assets)
      await tx.insert(tvboxReleaseAssets).values({ id: ulid(), releaseId: id, ...asset }).run();
  });

  for (const old of (await listReleases(db)).slice(keep))
    await removeRelease(db, old);
  await writeManifests(db);
  return await getRelease(db, id);
}

export async function updateRelease(
  db: AppDatabase,
  id: string,
  patch: { channel?: Channel | undefined; notes?: string | undefined; withdrawn?: boolean | undefined },
): Promise<ReleaseView> {
  await getRelease(db, id);
  await db.update(tvboxReleases).set({
    ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.withdrawn !== undefined ? { withdrawn: patch.withdrawn } : {}),
  }).where(eq(tvboxReleases.id, id)).run();
  await writeManifests(db);
  return await getRelease(db, id);
}

async function removeRelease(db: AppDatabase, release: ReleaseView): Promise<void> {
  for (const asset of release.assets)
    await deleteObject(releaseApkKey(release.versionCode, asset.mode, asset.abi));
  await db.delete(tvboxReleases).where(eq(tvboxReleases.id, release.id)).run();
}

export async function deleteRelease(db: AppDatabase, id: string): Promise<ReleaseView> {
  const release = await getRelease(db, id);
  await removeRelease(db, release);
  await writeManifests(db);
  return release;
}

/**
 * One manifest per channel and flavor, naming the newest release that has
 * an APK for it. Beta clients are offered stable releases too, whichever is
 * newer.
 */
async function writeManifests(db: AppDatabase): Promise<void> {
  const releases = (await listReleases(db)).filter(r => !r.withdrawn);
  const written: string[] = [];
  for (const channel of CHANNELS) {
    const eligible = releases.filter(r => channel === "beta" || r.channel === "stable");
    const newest = new Map<string, { release: ReleaseView; asset: AssetRow }>();
    for (const release of eligible) {
      for (const asset of release.assets) {
        const flavor = `${asset.mode}-${asset.abi}`;
        if (!newest.has(flavor))
          newest.set(flavor, { release, asset });
      }
    }
    for (const { release, asset } of newest.values()) {
      const manifest: UpdateManifest = {
        versionCode: release.versionCode,
        versionName: release.versionName,
        notes: release.notes,
        url: `../apk/${release.versionCode}/${asset.mode}-${asset.abi}.apk`,
        sha256: asset.sha256,
        size: asset.size,
        createdAt: release.createdAt,
      };
      const key = updateManifestKey(channel, asset.mode, asset.abi);
      await putObject(key, JSON.stringify(manifest));
      written.push(key);
    }
  }

  let previous: string[] = [];
  if (await objectExists(MANIFEST_INDEX_KEY))
    previous = JSON.parse(await readObjectText(MANIFEST_INDEX_KEY)) as string[];
  for (const key of previous.filter(k => !written.includes(k)))
    await deleteObject(key);
  await putObject(MANIFEST_INDEX_KEY, JSON.stringify(written));
}
