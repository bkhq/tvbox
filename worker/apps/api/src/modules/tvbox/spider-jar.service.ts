import type { AppDatabase } from "@/db";
import { eq } from "drizzle-orm";
import { ulid } from "@/shared/lib/id";
import { assetPath } from "./parse";
import { tvboxAssets } from "./schema";
import { storeUpload } from "./upload.service";

/**
 * Our own spider jar (tvbox.jar, built from spider/ by CI). A site uses it
 * with `"jar": "@tvbox"`; publishing puts the path of the jar uploaded last
 * there, so a new build reaches every such site without editing them.
 */
export const OWN_JAR = "@tvbox";

// The asset row that names the current jar.
const SOURCE = "spider:tvbox";

/** Store a new build; `changed` says whether it differs from the current one. */
export async function setOwnJar(db: AppDatabase, data: ArrayBuffer): Promise<{ path: string; md5: string; changed: boolean }> {
  const stored = await storeUpload(db, "tvbox.jar", data);
  const current = await db.select().from(tvboxAssets).where(eq(tvboxAssets.sourceUrl, SOURCE)).get();
  const row = { sha256: stored.sha256, md5: stored.md5, name: stored.name, size: stored.size, fetchedAt: new Date().toISOString() };
  if (current)
    await db.update(tvboxAssets).set(row).where(eq(tvboxAssets.id, current.id)).run();
  else
    await db.insert(tvboxAssets).values({ id: ulid(), sourceUrl: SOURCE, ...row }).run();
  return { path: stored.path, md5: stored.md5, changed: current?.sha256 !== stored.sha256 };
}

/** What `@tvbox` stands for in a published config; null before the first upload. */
export async function ownJarSpec(db: AppDatabase): Promise<string | null> {
  const row = await db.select().from(tvboxAssets).where(eq(tvboxAssets.sourceUrl, SOURCE)).get();
  return row ? `${assetPath(row)};md5;${row.md5}` : null;
}
