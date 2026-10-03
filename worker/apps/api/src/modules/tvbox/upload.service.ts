import type { AppDatabase } from "@/db";
import { eq } from "drizzle-orm";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { AppError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { assetName, assetPath } from "./parse";
import { tvboxAssets } from "./schema";
import { hashHex } from "./storage";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface StoredUpload {
  /** Use this in a config: it resolves under every device's subscription. */
  readonly path: string;
  readonly name: string;
  readonly sha256: string;
  readonly md5: string;
  readonly size: number;
}

/**
 * Keep a file of our own (a logo, a wallpaper, a spider) next to the mirrored
 * ones: content-addressed in blob storage and served at `./a/<sha256>/<name>`.
 */
export async function storeUpload(db: AppDatabase, filename: string, data: ArrayBuffer): Promise<StoredUpload> {
  if (data.byteLength === 0)
    throw new AppError("The file is empty", 422, "EMPTY_FILE");
  if (data.byteLength > MAX_UPLOAD_BYTES)
    throw new AppError(`The file is larger than ${MAX_UPLOAD_BYTES} bytes`, 413, "FILE_TOO_LARGE");

  const sha256 = hashHex("sha256", data);
  const asset = { sha256, md5: hashHex("md5", data), name: assetName(`https://upload/${encodeURIComponent(filename)}`) };
  const sourceUrl = `upload:${sha256}`;
  const existing = await db.select().from(tvboxAssets).where(eq(tvboxAssets.sourceUrl, sourceUrl)).get();
  if (!existing) {
    await getActiveDriver().put(deriveStorageKey(sha256), data);
    await db.insert(tvboxAssets).values({ id: ulid(), sourceUrl, ...asset, size: data.byteLength }).run();
  }
  return { path: assetPath(asset), ...asset, size: data.byteLength };
}
