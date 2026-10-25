import type { MediaDb } from "@/modules/media/db";
import type { PublishedSnapshot } from "@/modules/tvbox/compose";
import type { DevicesFile } from "@/modules/tvbox/storage";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { createMediaDb } from "@/modules/media/db";
import { composeForDevice } from "@/modules/tvbox/compose";
import { DEVICES_KEY, PUBLISHED_KEY } from "@/modules/tvbox/storage";
import { handleHome } from "./home";
import { handleMedia } from "./media";

/**
 * TVBox subscription served at `/s/<token>/`.
 *
 * Handled by the stateless Worker straight from the bucket the tvbox module
 * publishes into, so client traffic never wakes the Durable Object:
 *
 *   /s/<token>/ and /s/<token>/api.json  the device's config, composed from
 *                                        the published snapshot and the
 *                                        device's upstreams
 *   /s/<token>/a/<sha256>/<name>         a mirrored file, by content hash
 *   /s/<token>/media/home                the recommendation home (./home)
 *   /s/<token>/media/…                   the media library, from D1
 *                                        (./media)
 *
 * A device bound to linked apps serves its config only to a request with
 * one app's X-Device-Id and X-Device-Key, so the URL alone is not enough.
 * Files and the media library are not checked: files are addressed by
 * content, and not every client the app uses for them or for a site's API
 * sends the headers.
 *
 * The config references its files as `./a/...`, which TVBox resolves under
 * the same prefix, and the media library as `@media/...`, made absolute here
 * because a site's `api` is not resolved against the config's url.
 *
 * Every config leads with the recommendation home (HOME_SITE), so the app
 * opens it until the user picks another site.
 */

/** The slice of an R2 bucket this needs, so tests can pass a fake. */
export interface SubscriptionBucket {
  get: (
    key: string,
    options?: { range?: { offset: number; length: number } },
  ) => Promise<{ readonly body: ReadableStream | null; readonly size?: number; text: () => Promise<string> } | null>;
  head?: (key: string) => Promise<{ readonly size: number } | null>;
  put?: (key: string, value: string) => Promise<unknown>;
}

/** The media library: a D1 binding, whose sessions read from the nearest replica. */
export interface MediaDatabase {
  withSession?: (constraint: "first-unconstrained") => unknown;
}

export interface SubscriptionEnv {
  readonly FILES?: SubscriptionBucket | undefined;
  readonly MEDIA?: MediaDatabase | undefined;
  readonly TMDB_TOKEN?: string | undefined;
}

export const SUBSCRIPTION_PREFIX = "/s/";
/** Stands for `<origin>/s/<token>/media/` in a published entry. */
export const MEDIA_PLACEHOLDER = "@media/";
/** The recommendation home, first in every config. */
export const HOME_SITE = {
  key: "bk_home",
  name: "推荐 • 首页",
  type: 1,
  api: `${MEDIA_PLACEHOLDER}home`,
  searchable: 0,
  quickSearch: 0,
  changeable: 0,
};

// Per isolate and per bucket: a device change or a publish shows within this.
const CACHE_TTL_MS = 30_000;
// An unknown token re-reads sooner, so a device added a moment ago works at
// once; guessed tokens still cost at most one read per interval.
const MISS_REFRESH_MS = 2_000;
const RE_ASSET = /^\/a\/([0-9a-f]{64})\/[\w.-]+$/;
const CONTENT_TYPES: Record<string, string> = {
  jar: "application/java-archive",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  py: "text/x-python; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  m3u: "audio/x-mpegurl",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  m3u8: "application/vnd.apple.mpegurl",
};

type Device = DevicesFile["devices"][string];
const cache = new WeakMap<SubscriptionBucket, { at: number; devices: Map<string, Device>; snapshot: PublishedSnapshot | null }>();

async function readState(bucket: SubscriptionBucket, maxAgeMs = CACHE_TTL_MS) {
  const cached = cache.get(bucket);
  if (cached && Date.now() - cached.at < maxAgeMs)
    return cached;
  const [devicesObject, snapshotObject] = await Promise.all([
    bucket.get(DEVICES_KEY),
    bucket.get(PUBLISHED_KEY),
  ]);
  const devices = new Map(Object.entries(devicesObject
    ? (JSON.parse(await devicesObject.text()) as DevicesFile).devices
    : {}));
  const snapshot = snapshotObject
    ? JSON.parse(await snapshotObject.text()) as PublishedSnapshot
    : null;
  const state = {
    at: Date.now(),
    devices,
    snapshot,
  };
  cache.set(bucket, state);
  return state;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [
    ...new Uint8Array(digest),
  ].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function isBoundApp(request: Request, device: Device): Promise<boolean> {
  if (!device.bindings || device.bindings.length === 0)
    return true;
  const id = request.headers.get("x-device-id");
  const key = request.headers.get("x-device-key");
  if (!id || !key)
    return false;
  const keyHash = await sha256Hex(key);
  return device.bindings.some(b => b.id === id && b.keyHash === keyHash);
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

/** `media` stands in for the `MEDIA` binding in tests. */
export async function handleSubscription(request: Request, env: SubscriptionEnv, media?: MediaDb): Promise<Response> {
  const bucket = env.FILES;
  const { pathname } = new URL(request.url);
  const rest = pathname.slice(SUBSCRIPTION_PREFIX.length);
  const slash = rest.indexOf("/");
  if (!bucket || slash <= 0)
    return notFound();

  const token = rest.slice(0, slash);
  const hash = await sha256Hex(token);
  let state = await readState(bucket);
  if (!state.devices.has(hash))
    state = await readState(bucket, MISS_REFRESH_MS);
  const device = state.devices.get(hash);
  if (!device)
    return notFound();
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });

  const path = rest.slice(slash);
  if (path === "/" || path === "/api.json") {
    // A wrong or stale key looks like a wrong token: the app then asks for its current link.
    if (!state.snapshot || !(await isBoundApp(request, device)))
      return notFound();
    // `@media/…` (a site's `api`, a live source's `url`) names this device's media library.
    const composed = composeForDevice(state.snapshot, device.upstreams);
    const sites = Array.isArray(composed.sites)
      ? composed.sites
      : [];
    const config = JSON.stringify({
      ...composed,
      sites: [HOME_SITE, ...sites],
    })
      .replaceAll(`"${MEDIA_PLACEHOLDER}`, `"${new URL(request.url).origin}${SUBSCRIPTION_PREFIX}${token}/media/`);
    return new Response(config, {
      headers: { "content-type": CONTENT_TYPES.json!, "cache-control": "private, max-age=60" },
    });
  }

  if (path === "/media/home")
    return handleHome(request, { FILES: bucket, TMDB_TOKEN: env.TMDB_TOKEN });

  if (path.startsWith("/media/")) {
    const binding = media ?? env.MEDIA;
    if (!binding)
      return notFound();
    return handleMedia({
      request,
      db: media ?? createMediaDb(env.MEDIA!.withSession?.("first-unconstrained") ?? env.MEDIA),
      cacheKey: binding,
      path: path.slice("/media".length),
      assetBase: `${new URL(request.url).origin}${SUBSCRIPTION_PREFIX}${token}/a/`,
    });
  }

  const asset = RE_ASSET.exec(path);
  if (!asset)
    return notFound();
  const object = await bucket.get(deriveStorageKey(asset[1]!));
  if (!object)
    return notFound();
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
