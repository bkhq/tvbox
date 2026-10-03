import type { PublishedSnapshot } from "@/modules/tvbox/compose";
import type { DevicesFile } from "@/modules/tvbox/storage";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { composeForDevice } from "@/modules/tvbox/compose";
import { DEVICES_KEY, PUBLISHED_KEY } from "@/modules/tvbox/storage";

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
 *
 * The config references its files as `./a/...`, which TVBox resolves under
 * the same prefix.
 */

/** The slice of an R2 bucket this needs, so tests can pass a fake. */
export interface SubscriptionBucket {
  get: (key: string) => Promise<{ readonly body: ReadableStream | null; readonly size?: number; text: () => Promise<string> } | null>;
}

export interface SubscriptionEnv {
  readonly FILES?: SubscriptionBucket | undefined;
}

export const SUBSCRIPTION_PREFIX = "/s/";

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
  m3u8: "application/vnd.apple.mpegurl",
};

type Device = DevicesFile["devices"][string];
const cache = new WeakMap<SubscriptionBucket, { at: number; devices: Map<string, Device>; snapshot: PublishedSnapshot | null }>();

async function readState(bucket: SubscriptionBucket, maxAgeMs = CACHE_TTL_MS) {
  const cached = cache.get(bucket);
  if (cached && Date.now() - cached.at < maxAgeMs)
    return cached;
  const [devicesObject, snapshotObject] = await Promise.all([bucket.get(DEVICES_KEY), bucket.get(PUBLISHED_KEY)]);
  const devices = new Map(Object.entries(devicesObject ? (JSON.parse(await devicesObject.text()) as DevicesFile).devices : {}));
  const snapshot = snapshotObject ? JSON.parse(await snapshotObject.text()) as PublishedSnapshot : null;
  const state = { at: Date.now(), devices, snapshot };
  cache.set(bucket, state);
  return state;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

export async function handleSubscription(request: Request, env: SubscriptionEnv): Promise<Response> {
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
    if (!state.snapshot)
      return notFound();
    return new Response(JSON.stringify(composeForDevice(state.snapshot, device.upstreams)), {
      headers: { "content-type": CONTENT_TYPES.json!, "cache-control": "private, max-age=60" },
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
