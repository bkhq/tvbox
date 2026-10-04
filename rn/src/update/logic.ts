/**
 * Pure update logic: manifest URLs, validation, version compare and the
 * check itself. No React Native imports so it unit-tests without mocks.
 *
 * Contract: `<workerUrl>/u/rn/<channel>/<flavor>.json` returns the manifest;
 * its `url` is relative to the manifest URL. iOS/tvOS builds install through
 * the `.plist` sibling via itms-services.
 */

export type UpdateFlavor = 'android-universal' | 'ios-universal' | 'tvos-universal';

/** Only `stable` exists in v1. */
export type UpdateChannel = 'stable';
export const UPDATE_CHANNEL: UpdateChannel = 'stable';

export interface UpdatePlatform {
  OS: string;
  isTV: boolean;
}

export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  notes: string;
  url: string;
  sha256: string;
  size: number;
  bundleId?: string;
}

export interface Release extends UpdateManifest {
  flavor: UpdateFlavor;
  manifestUrl: string;
  /** Absolute APK/IPA URL resolved against the manifest URL. */
  binaryUrl: string;
  /** itms-services manifest for ipa flavors. */
  plistUrl?: string;
}

export type CheckResult =
  | { status: 'disabled' }
  | { status: 'unsupported' }
  | { status: 'up-to-date' }
  | { status: 'available'; release: Release }
  | { status: 'error'; error: unknown };

export type FetchJson = (url: string) => Promise<unknown>;

export interface CheckOptions {
  workerUrl: string;
  versionCode: number;
  platform: UpdatePlatform;
  fetchJson: FetchJson;
  /** Manual checks report failures; launch checks only log them. */
  manual?: boolean;
  log?: (message: string, error: unknown) => void;
}

/** Sign of `a - b` for version codes. */
export function compareVersion(a: number, b: number): number {
  return Math.sign(a - b);
}

export function isNewer(manifest: Pick<UpdateManifest, 'versionCode'>, current: number): boolean {
  return Number.isInteger(manifest.versionCode) && compareVersion(manifest.versionCode, current) > 0;
}

export function updateFlavor(platform: UpdatePlatform): UpdateFlavor | null {
  if (platform.OS === 'android') return 'android-universal';
  if (platform.OS === 'ios') return platform.isTV ? 'tvos-universal' : 'ios-universal';
  return null;
}

export function isIpaFlavor(flavor: UpdateFlavor): boolean {
  return flavor !== 'android-universal';
}

export function manifestUrl(workerUrl: string, channel: UpdateChannel, flavor: UpdateFlavor): string {
  return `${workerUrl}/u/rn/${channel}/${flavor}.json`;
}

export function plistUrl(workerUrl: string, channel: UpdateChannel, flavor: UpdateFlavor): string {
  return `${workerUrl}/u/rn/${channel}/${flavor}.plist`;
}

export function itmsServicesUrl(plist: string): string {
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(plist)}`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const URL_PARTS = /^([a-z][a-z0-9+.-]*:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/i;

function removeDotSegments(path: string): string {
  const output: string[] = [];
  const segments = path.split('/');
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '.') {
      if (last) output.push('');
    } else if (segment === '..') {
      if (output.length > 1 || (output.length === 1 && output[0] !== '')) output.pop();
      if (last) output.push('');
    } else {
      output.push(segment);
    }
  });
  return output.join('/');
}

/** RFC 3986 reference resolution, like OkHttp `HttpUrl.resolve`. */
export function resolveBinaryUrl(base: string, reference: string): string {
  if (SCHEME.test(reference)) return reference;
  const [, scheme = '', authority = '', basePath = '', baseQuery = ''] = URL_PARTS.exec(base) ?? [];
  if (reference.startsWith('//')) return scheme + reference;
  const [, , , refPath = '', refQuery, refFragment = ''] = URL_PARTS.exec(reference) ?? [];
  let path: string;
  let query: string;
  if (refPath === '') {
    path = basePath;
    query = refQuery ?? baseQuery;
  } else {
    const merged = refPath.startsWith('/')
      ? refPath
      : (authority && basePath === '' ? '/' : basePath.slice(0, basePath.lastIndexOf('/') + 1)) + refPath;
    path = removeDotSegments(merged);
    query = refQuery ?? '';
  }
  return scheme + authority + path + query + refFragment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the manifest JSON; null when the shape is wrong. */
export function parseManifest(json: unknown): UpdateManifest | null {
  if (!isRecord(json)) return null;
  const { versionCode, versionName, notes, url, sha256, size, bundleId } = json;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (typeof versionName !== 'string' || !versionName) return null;
  if (notes !== undefined && notes !== null && typeof notes !== 'string') return null;
  if (typeof url !== 'string' || !url) return null;
  if (typeof sha256 !== 'string') return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return null;
  if (bundleId !== undefined && typeof bundleId !== 'string') return null;
  const manifest: UpdateManifest = { versionCode, versionName, notes: notes ?? '', url, sha256, size };
  if (bundleId !== undefined) manifest.bundleId = bundleId;
  return manifest;
}

export class InvalidManifestError extends Error {
  constructor(readonly url: string) {
    super(`Invalid update manifest: ${url}`);
    this.name = 'InvalidManifestError';
  }
}

export async function checkForUpdate(options: CheckOptions): Promise<CheckResult> {
  const { workerUrl, versionCode, platform, fetchJson, manual = false, log = console.warn } = options;
  if (!workerUrl) return { status: 'disabled' };
  const flavor = updateFlavor(platform);
  if (!flavor) return { status: 'unsupported' };
  const url = manifestUrl(workerUrl, UPDATE_CHANNEL, flavor);
  try {
    const manifest = parseManifest(await fetchJson(url));
    if (!manifest) throw new InvalidManifestError(url);
    if (!isNewer(manifest, versionCode)) return { status: 'up-to-date' };
    const release: Release = { ...manifest, flavor, manifestUrl: url, binaryUrl: resolveBinaryUrl(url, manifest.url) };
    if (isIpaFlavor(flavor)) release.plistUrl = plistUrl(workerUrl, UPDATE_CHANNEL, flavor);
    return { status: 'available', release };
  } catch (error) {
    log('Update check failed', error);
    // A failed launch check is silent: report nothing to offer.
    return manual ? { status: 'error', error } : { status: 'up-to-date' };
  }
}
