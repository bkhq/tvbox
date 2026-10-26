import type { View } from "./query";
import type { MediaDb } from "@/modules/media/db";
import { and, eq } from "drizzle-orm";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { ASSET_PREFIX } from "@/modules/media/contract";
import { createMediaDb } from "@/modules/media/db";
import { readGeneration } from "@/modules/media/generation";
import { loadLive } from "@/modules/media/live/live.service";
import { toM3u } from "@/modules/media/live/m3u";
import { mediaClientChannels, mediaClients } from "@/modules/media/schema";
import { mediaV1 } from "./app";
import { handleCms } from "./cms";

/**
 * `/m/<client token>/…`: the media library as one client sees it, answered
 * from the D1 source tables. A client sees published titles that are public
 * or in one of its channels.
 *
 *   /v1/…                  the native Media API (./app.ts)
 *   /cms                   the same library as an Apple CMS site (./cms.ts)
 *   /live.m3u              the live channels as a playlist
 *   /a/<sha256>/<name>     an uploaded image, by content hash
 *
 * Responses differ between clients only by their channels and their asset
 * urls, so the shared cache is keyed by the url without the token, the
 * channels and the library's generation, which every admin write moves.
 * Asset placeholders are rewritten per client after the cache. Playback is
 * never cached, here or by the client.
 */

export const MEDIA_PREFIX = "/m/";

const V1 = "/v1";
const MAX_AGE = 60;

const v1 = mediaV1();
// How long an isolate trusts what it last read about a client; an unknown
// token is asked again sooner, so a client added a moment ago works at once.
const CLIENT_TTL_MS = 10_000;
const MISS_TTL_MS = 2_000;
const RE_ASSET = /^\/a\/([0-9a-f]{64})\/[\w.-]+$/;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** The media library: a D1 binding, whose sessions read from the nearest replica. */
export interface MediaDatabase {
  withSession?: (constraint: "first-unconstrained") => unknown;
}

export interface MediaBucket {
  get: (key: string) => Promise<{ readonly body: ReadableStream | null } | null>;
}

export interface MediaEnv {
  readonly FILES?: MediaBucket | undefined;
  readonly MEDIA?: MediaDatabase | undefined;
}

interface Client {
  readonly channels: readonly string[];
}

interface Known {
  readonly generation: { at: number; value: string } | null;
  readonly clients: Map<string, { at: number; client: Client | null }>;
}

// Per binding: a D1 session is new each request, the binding is not.
const known = new WeakMap<object, Known>();

function knownFor(binding: object): Known {
  let k = known.get(binding);
  if (!k) {
    k = {
      generation: null,
      clients: new Map(),
    };
    known.set(binding, k);
  }
  return k;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [
    ...new Uint8Array(digest),
  ].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function clientOf(db: MediaDb, binding: object, tokenHash: string): Promise<Client | null> {
  const k = knownFor(binding);
  const cached = k.clients.get(tokenHash);
  if (cached && Date.now() - cached.at < (cached.client ? CLIENT_TTL_MS : MISS_TTL_MS))
    return cached.client;
  const row = await db.select({ id: mediaClients.id }).from(mediaClients).where(and(eq(mediaClients.tokenHash, tokenHash), eq(mediaClients.enabled, true))).get();
  const client = row
    ? {
        channels: (await db.select({ id: mediaClientChannels.channelId }).from(mediaClientChannels).where(eq(mediaClientChannels.clientId, row.id)).all()).map(c => c.id).sort(),
      }
    : null;
  k.clients.set(tokenHash, {
    at: Date.now(),
    client,
  });
  return client;
}

async function generationOf(db: MediaDb, binding: object): Promise<string> {
  const k = knownFor(binding);
  if (k.generation && Date.now() - k.generation.at < CLIENT_TTL_MS)
    return k.generation.value;
  const value = await readGeneration(db);
  known.set(binding, {
    ...k,
    generation: {
      at: Date.now(),
      value,
    },
  });
  return value;
}

function error(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({
    error: { code, message },
  }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

interface CacheLike {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
}

function sharedCache(): CacheLike | undefined {
  return (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
}

async function answer(view: View, generation: string, path: string, url: URL): Promise<Response | null> {
  if (path.startsWith(`${V1}/`))
    return await v1.fetch(new Request(`https://media${path.slice(V1.length)}${url.search}`), { view, generation });
  if (path === "/cms")
    return await handleCms(view, url.searchParams);
  if (path === "/live.m3u") {
    return new Response(toM3u(await loadLive(view.db)), {
      headers: { "content-type": "audio/x-mpegurl; charset=utf-8" },
    });
  }
  return null;
}

async function serveAsset(bucket: MediaBucket | undefined, path: string): Promise<Response> {
  const asset = RE_ASSET.exec(path);
  const object = asset && bucket
    ? await bucket.get(deriveStorageKey(asset[1]!))
    : null;
  if (!object)
    return error(404, "NOT_FOUND", "Not found");
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return new Response(object.body, {
    headers: {
      "content-type": IMAGE_TYPES[ext] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

/** `/m/<token>/…`; `media` stands in for the `MEDIA` binding in tests. */
export async function handleMedia(request: Request, env: MediaEnv, media?: MediaDb): Promise<Response> {
  const url = new URL(request.url);
  const rest = url.pathname.slice(MEDIA_PREFIX.length);
  const slash = rest.indexOf("/");
  const binding = media ?? env.MEDIA;
  if (!binding || slash <= 0)
    return error(404, "NOT_FOUND", "Not found");
  if (request.method !== "GET" && request.method !== "HEAD")
    return error(405, "METHOD_NOT_ALLOWED", "Method not allowed");

  const db = media ?? createMediaDb(env.MEDIA!.withSession?.("first-unconstrained") ?? env.MEDIA);
  const token = rest.slice(0, slash);
  const client = await clientOf(db, binding, await sha256Hex(token));
  if (!client)
    return error(404, "NOT_FOUND", "Not found");

  const path = rest.slice(slash);
  if (path.startsWith("/a/"))
    return serveAsset(env.FILES, path);

  const generation = await generationOf(db, binding);
  const channels = client.channels.join(",");
  const cacheable = !path.startsWith(`${V1}/playback/`);
  const etag = `"${generation}.${(await sha256Hex(channels)).slice(0, 12)}"`;
  if (cacheable && request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { "etag": etag, "cache-control": `private, max-age=${MAX_AGE}` },
    });
  }

  url.searchParams.sort();
  const key = `${url.origin}/__media${path}?${url.searchParams.toString()}&__g=${generation}&__c=${encodeURIComponent(channels)}`;
  const cache = cacheable
    ? sharedCache()
    : undefined;
  const view: View = {
    db,
    channels: client.channels,
    today: new Date().toISOString().slice(0, 10),
  };
  let res = await cache?.match(key) ?? await answer(view, generation, path, url);
  if (!res)
    return error(404, "NOT_FOUND", "Not found");
  if (cache && res.status === 200 && !res.headers.has("cache-control")) {
    const body = await res.text();
    const headers = { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": `public, max-age=${MAX_AGE}` };
    await cache.put(key, new Response(body, { headers }));
    res = new Response(body, { headers });
  }

  const assetBase = `${url.origin}${MEDIA_PREFIX}${token}/a/`;
  const body = (await res.text()).replaceAll(`"${ASSET_PREFIX}`, `"${assetBase}`);
  const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8" });
  if (cacheable && res.status === 200) {
    headers.set("cache-control", `private, max-age=${MAX_AGE}`);
    headers.set("etag", etag);
  }
  else {
    headers.set("cache-control", "no-store");
  }
  return new Response(body, { status: res.status, headers });
}
