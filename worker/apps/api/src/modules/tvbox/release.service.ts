import type { App, UpdateManifest } from "./storage";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { tvboxReleaseAssets, tvboxReleases } from "./schema";
import { deleteObject, manifestIndexKey, objectExists, putObject, readObjectText, releaseFileKey, releaseKind, updateManifestKey } from "./storage";

export const CHANNELS = ["stable", "beta"] as const;
export type Channel = typeof CHANNELS[number];

type ReleaseRow = typeof tvboxReleases.$inferSelect;
type AssetRow = typeof tvboxReleaseAssets.$inferSelect;
export interface ReleaseView extends ReleaseRow {
  readonly assets: readonly AssetRow[];
}

export interface RegisterReleaseInput {
  /** Defaults to "tvbox". */
  readonly app?: App | undefined;
  readonly versionCode: number;
  readonly versionName: string;
  readonly channel: Channel;
  readonly notes: string;
  readonly assets: readonly {
    readonly mode: string;
    readonly abi: string;
    readonly sha256: string;
    readonly size: number;
    /** Required for the ipa flavors of the rn app. */
    readonly bundleId?: string | undefined;
  }[];
}

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
 * re-run of the release job is harmless. Older releases of the same app
 * beyond `keep` are deleted with their binaries.
 */
export async function registerRelease(db: AppDatabase, input: RegisterReleaseInput, keep: number): Promise<ReleaseView> {
  const app = input.app ?? "tvbox";
  for (const asset of input.assets) {
    const kind = releaseKind(app, asset.mode).toUpperCase();
    if (kind === "IPA" && !asset.bundleId)
      throw new AppError(`No bundle id for ${asset.mode}-${asset.abi}`, 422, "BUNDLE_ID_MISSING");
    if (!(await objectExists(releaseFileKey(input.versionCode, asset.mode, asset.abi, app))))
      throw new AppError(`No ${kind} uploaded for ${asset.mode}-${asset.abi}`, 422, `${kind}_MISSING`);
  }

  const existing = await db.select().from(tvboxReleases).where(and(eq(tvboxReleases.app, app), eq(tvboxReleases.versionCode, input.versionCode))).get();
  const id = existing?.id ?? ulid();
  await db.transaction(async (tx) => {
    const fields = { versionName: input.versionName, channel: input.channel, notes: input.notes, withdrawn: false };
    if (existing) {
      await tx.update(tvboxReleases).set(fields).where(eq(tvboxReleases.id, id)).run();
      await tx.delete(tvboxReleaseAssets).where(eq(tvboxReleaseAssets.releaseId, id)).run();
    }
    else {
      await tx.insert(tvboxReleases).values({ id, app, versionCode: input.versionCode, ...fields }).run();
    }
    for (const asset of input.assets)
      await tx.insert(tvboxReleaseAssets).values({ id: ulid(), releaseId: id, ...asset }).run();
  });

  for (const old of (await listReleases(db)).filter(r => r.app === app).slice(keep))
    await removeRelease(db, old);
  await writeManifests(db, app);
  return await getRelease(db, id);
}

export async function updateRelease(
  db: AppDatabase,
  id: string,
  patch: { channel?: Channel | undefined; notes?: string | undefined; withdrawn?: boolean | undefined },
): Promise<ReleaseView> {
  const { app } = await getRelease(db, id);
  await db.update(tvboxReleases).set({
    ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.withdrawn !== undefined ? { withdrawn: patch.withdrawn } : {}),
  }).where(eq(tvboxReleases.id, id)).run();
  await writeManifests(db, app);
  return await getRelease(db, id);
}

async function removeRelease(db: AppDatabase, release: ReleaseView): Promise<void> {
  for (const asset of release.assets)
    await deleteObject(releaseFileKey(release.versionCode, asset.mode, asset.abi, release.app));
  await db.delete(tvboxReleases).where(eq(tvboxReleases.id, release.id)).run();
}

export async function deleteRelease(db: AppDatabase, id: string): Promise<ReleaseView> {
  const release = await getRelease(db, id);
  await removeRelease(db, release);
  await writeManifests(db, release.app);
  return release;
}

/**
 * One manifest per channel and flavor of `app`, naming the newest release
 * that has a binary for it. Beta clients are offered stable releases too,
 * whichever is newer.
 */
async function writeManifests(db: AppDatabase, app: App): Promise<void> {
  const releases = (await listReleases(db)).filter(r => r.app === app && !r.withdrawn);
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
      const kind = releaseKind(app, asset.mode);
      const manifest: UpdateManifest = {
        versionCode: release.versionCode,
        versionName: release.versionName,
        notes: release.notes,
        url: `../${kind}/${release.versionCode}/${asset.mode}-${asset.abi}.${kind}`,
        sha256: asset.sha256,
        size: asset.size,
        createdAt: release.createdAt,
        ...(kind === "ipa" && asset.bundleId ? { bundleId: asset.bundleId } : {}),
      };
      const key = updateManifestKey(channel, asset.mode, asset.abi, app);
      await putObject(key, JSON.stringify(manifest));
      written.push(key);
    }
  }

  // Manifests written last time, so a flavor that no longer has a release
  // loses its manifest instead of offering a deleted APK.
  const indexKey = manifestIndexKey(app);
  let previous: string[] = [];
  if (await objectExists(indexKey))
    previous = JSON.parse(await readObjectText(indexKey)) as string[];
  for (const key of previous.filter(k => !written.includes(k)))
    await deleteObject(key);
  await putObject(indexKey, JSON.stringify(written));
}
