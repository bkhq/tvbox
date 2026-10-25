import type { DurableObjectNamespace, DurableObjectState, Fetcher, R2Bucket } from "@cloudflare/workers-types";
import type { MediaDatabase, SubscriptionBucket } from "./subscription";
import { bootstrap } from "@/app";
import { createMediaDb, setMediaDb } from "@/modules/media/db";
import { setReadModelDb } from "@/modules/media/readmodel/store";
import { setPlatform } from "@/platform";
import { handleControl } from "./control";
import { handleDoh } from "./doh";
import { handleLanding } from "./landing";
import { createWorkersPlatform } from "./platform";
import { registerR2Driver } from "./r2";
import { ENROLL_PATH, normalizeBasePath, routeRequest } from "./router";
import { handleSubscription } from "./subscription";
import { handleUpdates } from "./updates";

/**
 * Cloudflare Workers entry point.
 *
 * The Worker itself holds no state: it forwards every request to a single
 * Durable Object instance that owns the SQLite database and runs the whole
 * Hono app. That keeps the deployment shaped like the Bun one — one
 * process, one database, in-process caches — rather than spreading state
 * across isolates.
 *
 * Static assets are served by the platform's asset pipeline (see
 * `wrangler.jsonc`), so the app's own filesystem-backed static middleware
 * stays disabled here.
 */

export interface WorkerEnv {
  /** Binding for the Durable Object class exported below. */
  APP: DurableObjectNamespace;
  /** Blob storage for the file module. Required when FILE_STORAGE_DRIVER=r2. */
  FILES?: R2Bucket;
  /** The media library's read model (D1), written by publishing and read by `/s/<token>/media`. */
  MEDIA?: MediaDatabase;
  /** The console SPA (apps/web/dist). */
  ASSETS: Fetcher;
  /** Prefix of the console and its API, e.g. "/mg". */
  BASE_PATH?: string;
  /** TMDB key for the recommendation home's Netflix rows (./home.ts). */
  TMDB_TOKEN?: string;
  [key: string]: unknown;
}

type FetchHandler = (req: Request, env?: Record<string, unknown>) => Response | Promise<Response>;

/** Carries the deployment's configuration identity to the Durable Object. */
const CONFIG_VERSION_HEADER = "x-app-config-version";

/**
 * A stable digest of every string-valued binding — the `vars` and secrets the
 * app parses into its `Config`.
 *
 * A Durable Object keeps the `env` it was constructed with for as long as it
 * stays resident, and this app schedules alarms, so it can stay resident
 * indefinitely. Without this, `wrangler secret put` appears to do nothing:
 * the new value is bound to new invocations of the stateless Worker while the
 * object serving every request still holds the old one.
 */
async function envFingerprint(env: Record<string, unknown>): Promise<string> {
  const pairs = Object.entries(env)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pairs));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export class AppDurableObject {
  readonly #state: DurableObjectState;
  #fetchApp: FetchHandler | undefined;
  #runDueTasks: (() => Promise<void>) | undefined;
  #configVersion: string | undefined;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.#state = state;
    // Nothing is served until the platform is installed and migrations have
    // run: `blockConcurrencyWhile` holds every inbound event, including the
    // alarm, until boot resolves.
    void state.blockConcurrencyWhile(async () => {
      const { platform, runDueTasks } = createWorkersPlatform({
        env: env as Record<string, unknown>,
        storage: state.storage,
      });
      setPlatform(platform);
      if (env.FILES) {
        registerR2Driver(env.FILES);
      }
      setReadModelDb(env.MEDIA ?? null);
      setMediaDb(env.MEDIA ? createMediaDb(env.MEDIA) : null);
      this.#configVersion = await envFingerprint(env as Record<string, unknown>);
      const app = await bootstrap();
      this.#fetchApp = app.fetch;
      this.#runDueTasks = runDueTasks;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.#fetchApp) {
      return new Response("Service starting", { status: 503 });
    }

    // The configuration this object booted with is no longer the deployed
    // one. It cannot adopt the new `env` in place, so it resets; the next
    // request constructs it against the current bindings. The header is set
    // by the stateless Worker below and therefore cannot be forged from
    // outside.
    const deployed = request.headers.get(CONFIG_VERSION_HEADER);
    if (deployed !== null && this.#configVersion !== undefined && deployed !== this.#configVersion) {
      this.#state.abort("configuration changed");
      return new Response("Configuration changed, restarting", { status: 503 });
    }

    return this.#fetchApp(request, {});
  }

  /** Durable Object alarm: the Workers stand-in for the Bun sweep timers. */
  async alarm(): Promise<void> {
    await this.#runDueTasks?.();
  }

  /** Exposed for the deployed smoke test; see tests/workers. */
  get id(): string {
    return this.#state.id.toString();
  }
}

// Computed once per isolate: the bindings cannot change under a running
// version, so re-digesting them on every request would be pure overhead.
let cachedConfigVersion: string | undefined;

async function configVersion(env: Record<string, unknown>): Promise<string> {
  cachedConfigVersion ??= await envFingerprint(env);
  return cachedConfigVersion;
}

// A path with a file extension is an asset: a miss is a 404, not the SPA.
const RE_FILE = /\/[^/][^./]*\.[^/]+$/;

/**
 * The console SPA: its assets, or its index.html for a client-side route.
 * Marked noindex; the path is not linked from anywhere public either.
 */
async function serveConsole(request: Request, assets: Fetcher, base: string): Promise<Response> {
  let res = await assets.fetch(request as never) as unknown as Response;
  if (res.status === 404 && !RE_FILE.test(new URL(request.url).pathname))
    res = await assets.fetch(new URL(`${base}/`, request.url).toString()) as unknown as Response;
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const base = normalizeBasePath(env.BASE_PATH);
    const files = { FILES: env.FILES as unknown as SubscriptionBucket | undefined };

    // Everything but the API is answered here, without the database.
    let target = request;
    switch (routeRequest(url.pathname, base)) {
      case "landing":
        return handleLanding(request, files);
      case "subscription":
        return handleSubscription(request, { ...files, MEDIA: env.MEDIA, TMDB_TOKEN: env.TMDB_TOKEN });
      case "updates":
        return handleUpdates(request, files);
      case "doh":
        return handleDoh(request);
      case "control":
        return handleControl(request);
      case "redirect":
        return Response.redirect(new URL(`${base}/`, url).toString(), 301);
      case "console":
        return serveConsole(request, env.ASSETS, base);
      case "missing":
        return new Response("Not Found", { status: 404 });
      case "enroll":
        target = new Request(new URL(`${base}${ENROLL_PATH}${url.search}`, url).toString(), request);
        break;
      case "app":
        break;
    }

    // One named instance: this app has a single database, so it has a
    // single object. Sharding would mean sharding the database too.
    const stub = env.APP.get(env.APP.idFromName("app"));

    // Overwritten, never appended: a client cannot talk the object into
    // resetting by sending this header itself.
    const headers = new Headers(target.headers);
    headers.set(CONFIG_VERSION_HEADER, await configVersion(env as Record<string, unknown>));
    const forwarded = new Request(target, { headers });

    return stub.fetch(forwarded as never) as unknown as Response;
  },
};
