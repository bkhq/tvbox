import { createHash } from "node:crypto";
import { getActiveDriver } from "@/modules/file/storage/registry";

/**
 * Object keys shared with the stateless Worker (`workers/subscription.ts`),
 * which reads them straight from the bucket so TVBox clients never reach the
 * Durable Object. Mirrored files use the file module's content-addressed
 * `deriveStorageKey(sha256)`.
 */
export const CURRENT_CONFIG_KEY = "tvbox/config/current.json";
export const TOKENS_KEY = "tvbox/tokens.json";

/** APK uploaded by CI for one flavor of a release. */
export function releaseApkKey(versionCode: number, mode: string, abi: string): string {
  return `tvbox/releases/${versionCode}/${mode}-${abi}.apk`;
}

/** Update manifest a client of `mode`/`abi` on `channel` reads. */
export function updateManifestKey(channel: string, mode: string, abi: string): string {
  return `tvbox/updates/${channel}/${mode}-${abi}.json`;
}

export interface UpdateManifest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly notes: string;
  /** Path of the APK, relative to the manifest. */
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: string;
}

export function publishedConfigKey(id: string): string {
  return `tvbox/config/${id}.json`;
}

export interface TokensFile {
  /** SHA-256 hex of every enabled subscription token. */
  readonly hashes: readonly string[];
}

export function hashHex(algorithm: "sha256" | "md5", data: ArrayBuffer | string): string {
  const hash = createHash(algorithm);
  hash.update(typeof data === "string" ? data : new Uint8Array(data));
  return hash.digest("hex");
}

export async function putObject(key: string, data: ArrayBuffer | string): Promise<void> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data).buffer : data;
  await getActiveDriver().put(key, bytes);
}

export async function deleteObject(key: string): Promise<void> {
  await getActiveDriver().delete(key);
}

export async function objectExists(key: string): Promise<boolean> {
  return await getActiveDriver().exists(key);
}

export async function readObjectText(key: string): Promise<string> {
  const stream = await getActiveDriver().getStream(key);
  return await new Response(stream).text();
}
