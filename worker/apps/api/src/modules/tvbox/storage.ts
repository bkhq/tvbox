import { createHash } from "node:crypto";
import { getActiveDriver } from "@/modules/file/storage/registry";

/**
 * Object keys shared with the stateless Worker (`workers/subscription.ts`,
 * `workers/updates.ts`), which reads them straight from the bucket so TVBox
 * clients never reach the Durable Object. Mirrored files use the file module's content-addressed
 * `deriveStorageKey(sha256)`.
 */
export const PUBLISHED_KEY = "tvbox/publish/current.json";
export const DEVICES_KEY = "tvbox/devices.json";

/** The published state every device's config is composed from. */
export function publishSnapshotKey(id: string): string {
  return `tvbox/publish/${id}.json`;
}

export interface DeviceBinding {
  /** The app's X-Device-Id. */
  readonly id: string;
  /** SHA-256 of its X-Device-Key. */
  readonly keyHash: string;
}

export interface DevicesFile {
  /**
   * By SHA-256 of the token; `upstreams: null` means every upstream. With
   * `bindings`, the config is served only to a request carrying one of them.
   */
  readonly devices: Record<string, {
    readonly id: string;
    readonly upstreams: readonly string[] | null;
    readonly bindings?: readonly DeviceBinding[];
  }>;
}

/**
 * The Java app ("tvbox") and the React Native app ("rn") are released on
 * separate channels: the rn objects live under `tvbox/rn/`, so the tvbox keys
 * stay as they always were.
 */
export const APPS = ["tvbox", "rn"] as const;
export type App = typeof APPS[number];

/** iOS and tvOS builds of the rn app ship as an ipa, everything else as an APK. */
export function releaseKind(app: App, mode: string): "apk" | "ipa" {
  return app === "rn" && (mode === "ios" || mode === "tvos")
    ? "ipa"
    : "apk";
}

function appPrefix(app: App): string {
  return app === "rn"
    ? "tvbox/rn"
    : "tvbox";
}

/** Binary uploaded by CI for one flavor of a release. */
export function releaseFileKey(versionCode: number, mode: string, abi: string, app: App = "tvbox"): string {
  return `${appPrefix(app)}/releases/${versionCode}/${mode}-${abi}.${releaseKind(app, mode)}`;
}

/** Keys of every update manifest of `app` currently written (a JSON array). */
export function manifestIndexKey(app: App): string {
  return `${appPrefix(app)}/updates/index.json`;
}

/** The tvbox one, which the download page lists. */
export const MANIFEST_INDEX_KEY = manifestIndexKey("tvbox");

/** Update manifest a client of `mode`/`abi` on `channel` reads. */
export function updateManifestKey(channel: string, mode: string, abi: string, app: App = "tvbox"): string {
  return `${appPrefix(app)}/updates/${channel}/${mode}-${abi}.json`;
}

export interface UpdateManifest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly notes: string;
  /** Path of the APK (or ipa), relative to the manifest. */
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: string;
  /** Only for ipa flavors: the itms-services manifest needs it. */
  readonly bundleId?: string;
}

export function hashHex(algorithm: "sha256" | "md5", data: ArrayBuffer | string): string {
  const hash = createHash(algorithm);
  hash.update(typeof data === "string"
    ? data
    : new Uint8Array(data));
  return hash.digest("hex");
}

export async function putObject(key: string, data: ArrayBuffer | string): Promise<void> {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data).buffer
    : data;
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
