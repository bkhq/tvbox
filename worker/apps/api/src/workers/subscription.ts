import type { TokensFile } from "@/modules/tvbox/storage";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { CURRENT_CONFIG_KEY, TOKENS_KEY } from "@/modules/tvbox/storage";

/**
 * TVBox subscription served at `/s/<token>/`.
 *
 * Handled by the stateless Worker straight from the bucket the tvbox module
 * publishes into, so client traffic never wakes the Durable Object:
 *
 *   /s/<token>/ and /s/<token>/api.json  the published config
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

const TOKENS_TTL_MS = 30_000;
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

// Per isolate and per bucket: a revoked token stops working within the TTL.
const tokenCache = new WeakMap<SubscriptionBucket, { at: number; hashes: Set<string> }>();

async function knownTokenHashes(bucket: SubscriptionBucket): Promise<Set<string>> {
  const cached = tokenCache.get(bucket);
  if (cached && Date.now() - cached.at < TOKENS_TTL_MS)
    return cached.hashes;
  const object = await bucket.get(TOKENS_KEY);
  const hashes = new Set(object ? (JSON.parse(await object.text()) as TokensFile).hashes : []);
  tokenCache.set(bucket, { at: Date.now(), hashes });
  return hashes;
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
  if (!(await knownTokenHashes(bucket)).has(await sha256Hex(token)))
    return notFound();
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });

  const path = rest.slice(slash);
  if (path === "/" || path === "/api.json") {
    const object = await bucket.get(CURRENT_CONFIG_KEY);
    if (!object)
      return notFound();
    return new Response(object.body, {
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
