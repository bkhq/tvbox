import type { MediaDb } from "@/modules/media/db";
import { ASSET_PREFIX } from "@/modules/media/contract";
import { loadLive } from "@/modules/media/live/live.service";
import { toM3u } from "@/modules/media/live/m3u";
import { publishedGeneration } from "@/modules/media/publish";
import { mediaV1 } from "./app";
import { handleCms } from "./cms";

/**
 * `/s/<token>/media/…`, answered from the D1 source tables:
 *
 *   /media/v1/…       the native Media API (./app.ts)
 *   /media/cms        the same library as an Apple CMS site (./cms.ts)
 *   /media/live.m3u   the live channels as a playlist
 *
 * Responses are the same for every device but for asset urls, so the shared
 * cache is keyed by the url without the token, plus the last publish's
 * generation: a publish moves every key, and nothing stale is served past the
 * generation's own refresh. Asset placeholders are rewritten per device after
 * the cache. Playback is never cached, here or by the client.
 */

const V1 = "/v1";
const MAX_AGE = 60;
// How long an isolate trusts the generation it last read.
const GENERATION_TTL_MS = 10_000;

const v1 = mediaV1();
const generations = new WeakMap<object, { at: number; value: string | null }>();

async function generationOf(db: MediaDb, key: object): Promise<string | null> {
  const cached = generations.get(key);
  if (cached && Date.now() - cached.at < GENERATION_TTL_MS)
    return cached.value;
  const value = await publishedGeneration(db);
  generations.set(key, { at: Date.now(), value });
  return value;
}

function error(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
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

export interface MediaRequest {
  readonly request: Request;
  /** The library; `cacheKey` identifies its binding across requests (a D1 session is new each time). */
  readonly db: MediaDb;
  readonly cacheKey: object;
  /** Path below `/s/<token>/media`. */
  readonly path: string;
  /** Where this device's assets live: `<origin>/s/<token>/a/`. */
  readonly assetBase: string;
}

async function answer(db: MediaDb, generation: string, path: string, url: URL): Promise<Response | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (path.startsWith(`${V1}/`))
    return await v1.fetch(new Request(`https://media${path.slice(V1.length)}${url.search}`), { db, generation, today });
  if (path === "/cms")
    return await handleCms(db, url.searchParams, today);
  if (path === "/live.m3u")
    return new Response(toM3u(await loadLive(db)), { headers: { "content-type": "audio/x-mpegurl; charset=utf-8" } });
  return null;
}

export async function handleMedia({ request, db, cacheKey, path, assetBase }: MediaRequest): Promise<Response> {
  const generation = await generationOf(db, cacheKey);
  if (!generation)
    return error(503, "NOT_PUBLISHED", "The media library has not been published yet");

  const url = new URL(request.url);
  const cacheable = !path.startsWith(`${V1}/playback/`);
  const etag = `"${generation}"`;
  if (cacheable && request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { "etag": etag, "cache-control": `private, max-age=${MAX_AGE}` } });

  url.searchParams.sort();
  const key = `${url.origin}/__media${path}?${url.searchParams.toString()}&__g=${generation}`;
  const cache = cacheable ? sharedCache() : undefined;
  let res = await cache?.match(key) ?? await answer(db, generation, path, url);
  if (!res)
    return error(404, "NOT_FOUND", "Not found");
  if (cache && res.status === 200 && !res.headers.has("cache-control")) {
    const body = await res.text();
    const headers = { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": `public, max-age=${MAX_AGE}` };
    await cache.put(key, new Response(body, { headers }));
    res = new Response(body, { headers });
  }

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
