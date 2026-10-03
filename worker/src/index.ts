import { patch, type Config } from "./patch";

interface Env {
  UPSTREAM: string;
  // Secret path prefix; set with `wrangler secret put TOKEN` (or .dev.vars locally).
  TOKEN?: string;
}

const CONFIG_PATH = "/api.json";
const CONFIG_TTL = 300;
const FILE_TTL = 3600;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Anything outside /<TOKEN>/ looks like a missing page; an unset TOKEN locks everything.
    const { pathname } = new URL(request.url);
    const prefix = `/${env.TOKEN}/`;
    if (!env.TOKEN || !pathname.startsWith(prefix)) {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const rest = pathname.slice(prefix.length - 1);
    const path = rest === "/" ? CONFIG_PATH : rest;
    const isConfig = path === CONFIG_PATH;
    const ttl = isConfig ? CONFIG_TTL : FILE_TTL;

    const upstream = await fetch(env.UPSTREAM + path, {
      cf: { cacheTtl: ttl, cacheEverything: true },
    });
    if (!upstream.ok) {
      return new Response(`Upstream returned ${upstream.status}`, { status: 502 });
    }

    const headers = { "cache-control": `public, max-age=${ttl}` };
    if (isConfig) {
      return Response.json(patch(await upstream.json<Config>()), { headers });
    }
    // Relative paths in the config (./spider.jar, ./json/*) resolve to this worker,
    // so other files are passed through unchanged and their md5 stays valid.
    return new Response(upstream.body, {
      headers: { ...headers, "content-type": upstream.headers.get("content-type") ?? "application/octet-stream" },
    });
  },
};
