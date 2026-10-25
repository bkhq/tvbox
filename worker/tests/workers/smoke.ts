#!/usr/bin/env bun
/**
 * Cloudflare Workers smoke test.
 *
 * Boots the app the way it actually runs on Cloudflare — one Durable
 * Object owning a SQLite database, R2 for blobs — and drives the paths
 * whose behaviour differs from Bun:
 *
 *   1. boot          — migrations run inside the Durable Object
 *   2. writes        — create, read back and delete through the Durable
 *                      Object's SQLite (see `workers/db.ts`)
 *   3. assets        — the SPA is served by the asset pipeline
 *   4. tvbox         — sync a real upstream into R2, publish, and read it back
 *                      through `/s/<token>/` without the Durable Object
 *   5. media         — publish the library in D1 and read it back
 *                      through `/s/<token>/media/v1`
 *   6. rate limiting — the creation cap is enforced from the database
 *
 * With `--oidc` it checks a deployment configured for OpenID Connect
 * instead. Such a deployment has no local password to log in with — the SPA
 * offers one login method or the other — so the authenticated cases are
 * replaced by ones that prove the provider wiring: the app reports an
 * OAuth-configured mode, and starting a login redirects to the issuer
 * carrying a PKCE challenge.
 *
 * Usage:
 *   bun tests/workers/smoke.ts                 # spawns `wrangler dev`
 *   bun tests/workers/smoke.ts --url https://… # runs against a deployment
 *   bun tests/workers/smoke.ts --url … --oidc  # OIDC deployment
 */
import type { Subprocess } from "bun";
import { rmSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

// Local runs use the fixture in apps/api/.dev.vars.example. A run against a
// real deployment passes freshly generated credentials instead, so a
// publicly reachable URL never carries a password that is committed here.
const USERNAME = process.env.SMOKE_USERNAME ?? "smoke";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "smoke-test-password";
// A real upstream: the smoke test pulls it the way the scheduled sync does.
const SMOKE_UPSTREAM = process.env.SMOKE_UPSTREAM ?? "https://raw.githubusercontent.com/qist/tvbox/master/xiaosa/api.json";
let subscriptionToken = "";
const RELEASE_TOKEN = process.env.SMOKE_RELEASE_TOKEN ?? "smoke-release-token-0123456789abcdef";
const PORT = 8787;
// The console and its API live under this prefix (BASE_PATH in wrangler.toml).
const BASE_PATH = process.env.SMOKE_BASE_PATH ?? "/mg";

interface Case {
  name: string;
  run: () => Promise<void>;
}

class SmokeError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond)
    throw new SmokeError(msg);
}

let baseUrl = "";
let cookie = "";

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // csrfGuard wants both an `X-Requested-With` header and a matching Origin
  // on state-changing requests; the SPA client sets the same pair.
  headers.set("Origin", baseUrl);
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (cookie)
    headers.set("Cookie", cookie);
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0)
    cookie = setCookie.map(c => c.split(";")[0]).join("; ");
  return res;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  }
  catch {
    throw new SmokeError(`expected JSON, got ${res.status}: ${text.slice(0, 300)}`);
  }
}

const cases: Case[] = [
  {
    name: "health endpoint responds",
    async run() {
      const res = await call(`${BASE_PATH}/api/health`);
      assert(res.status === 200, `health returned ${res.status}`);
      const body = await json<{ status: string }>(res);
      assert(body.status === "ok", `health status was ${body.status}`);
    },
  },
  {
    name: "single-user login issues a session",
    async run() {
      const res = await call(`${BASE_PATH}/api/account/auth/login-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      });
      if (res.status !== 200)
        throw new SmokeError(`login returned ${res.status}: ${await res.text()}`);
      assert(cookie !== "", "login did not set a session cookie");
    },
  },
  {
    name: "group create commits its transaction",
    async run() {
      const res = await call(`${BASE_PATH}/api/account/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "smoke-group", description: "written on workers" }),
      });
      if (res.status !== 201)
        throw new SmokeError(`create returned ${res.status}: ${await res.text()}`);
      const created = await json<{ data: { id: string } }>(res);

      const read = await call(`${BASE_PATH}/api/account/groups/${created.data.id}`);
      assert(read.status === 200, `read-back returned ${read.status}`);
      const group = await json<{ data: { name: string } }>(read);
      assert(group.data.name === "smoke-group", "group name did not round-trip");
    },
  },
  {
    name: "deleting a group removes it",
    async run() {
      const created = await json<{ data: { id: string } }>(
        await call(`${BASE_PATH}/api/account/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "smoke-delete" }),
        }),
      );
      const { id } = created.data;

      const del = await call(`${BASE_PATH}/api/account/groups/${id}`, { method: "DELETE" });
      if (del.status >= 300)
        throw new SmokeError(`delete returned ${del.status}: ${await del.text()}`);
      await del.text();

      const gone = await call(`${BASE_PATH}/api/account/groups/${id}`);
      assert(gone.status === 404, `a deleted group still answers ${gone.status}`);
      await gone.text();
    },
  },
  {
    name: "the site root is the download page",
    async run() {
      const res = await fetch(`${baseUrl}/`);
      assert(res.status === 200, `the download page returned ${res.status}`);
      const body = await res.text();
      assert(body.includes("TVBox 下载"), "the root is not the download page");
    },
  },
  {
    name: "the console SPA is served under its base path, deep links included",
    async run() {
      for (const path of [`${BASE_PATH}/`, `${BASE_PATH}/admin/devices`]) {
        const res = await fetch(`${baseUrl}${path}`);
        assert(res.status === 200, `${path} returned ${res.status}`);
        const body = await res.text();
        assert(body.includes(`src="${BASE_PATH}/assets/`), `${path} is not the console SPA`);
      }
      const asset = await fetch(`${baseUrl}${BASE_PATH}/assets/missing.js`);
      assert(asset.status === 404, `a missing asset returned ${asset.status}`);
      await asset.text();
    },
  },
  {
    name: "the raw API reaches the Worker and carries no browser headers",
    async run() {
      const res = await fetch(`${baseUrl}${BASE_PATH}/api/raw/health`);
      assert(res.status === 200, `raw health returned ${res.status}`);
      assert((res.headers.get("content-type") ?? "").includes("application/json"), "raw API answered with something other than JSON");
      assert(res.headers.get("content-security-policy") === null, "raw API carries a CSP");
      assert(res.headers.get("cross-origin-resource-policy") === null, "raw API restricts cross-origin readers");
    },
  },
  {
    name: "an upstream syncs, mirrors its files and publishes",
    async run() {
      const created = await call(`${BASE_PATH}/api/tvbox/upstreams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "xiaosa", url: SMOKE_UPSTREAM }),
      });
      if (created.status !== 201)
        throw new SmokeError(`creating the upstream returned ${created.status}: ${await created.text()}`);
      const upstream = await json<{ data: { id: string } }>(created);

      const synced = await call(`${BASE_PATH}/api/tvbox/upstreams/${upstream.data.id}/sync`, { method: "POST" });
      if (synced.status !== 200)
        throw new SmokeError(`sync returned ${synced.status}: ${await synced.text()}`);
      const result = await json<{ data: { added: number; assets: { mirrored: number } } }>(synced);
      assert(result.data.added > 0, "the sync imported nothing");
      assert(result.data.assets.mirrored > 0, "the sync mirrored no files into R2");

      const published = await call(`${BASE_PATH}/api/tvbox/publishes`, { method: "POST" });
      assert(published.status === 201, `publish returned ${published.status}`);
      await published.text();

      const device = await call(`${BASE_PATH}/api/tvbox/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "smoke" }),
      });
      assert(device.status === 201, `creating a device returned ${device.status}`);
      subscriptionToken = (await json<{ data: { token: string } }>(device)).data.token;
    },
  },
  {
    // Durable Object SQLite binds at most 100 parameters per statement; the
    // synced upstream gives well over 100 entries to act on at once.
    name: "bulk updates, a full reorder and a health report cover more than 100 entries",
    async run() {
      const all = await json<{ data: { id: string; kind: string }[] }>(await call(`${BASE_PATH}/api/tvbox/entries`));
      assert(all.data.length > 100, `only ${all.data.length} entries to act on`);
      const post = (path: string, body: unknown) => call(`${BASE_PATH}/api/tvbox${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const bulk = await post("/entries/bulk", {
        ids: all.data.map(e => e.id),
        enabled: true,
      });
      assert(bulk.status === 200, `bulk update returned ${bulk.status}`);
      await bulk.text();

      const sites = all.data.filter(e => e.kind === "sites").map(e => e.id);
      const reorder = await post("/entries/reorder", {
        kind: "sites",
        ids: [...sites].reverse(),
      });
      assert(reorder.status === 200, `reordering ${sites.length} sites returned ${reorder.status}`);
      await reorder.text();
      const back = await post("/entries/reorder", { kind: "sites", ids: sites });
      await back.text();

      const health = await post("/health", {
        results: all.data.map(e => ({ id: e.id, status: "ok", detail: "smoke" })),
      });
      assert(health.status === 200, `the health report returned ${health.status}`);
      const outcome = await json<{ data: { recorded: number } }>(health);
      assert(outcome.data.recorded === all.data.length, "the health report did not record every entry");
    },
  },
  {
    name: "the subscription serves the published config and its mirrored spider",
    async run() {
      const res = await fetch(`${baseUrl}/s/${subscriptionToken}/api.json`);
      if (res.status !== 200)
        throw new SmokeError(`subscription returned ${res.status}: ${await res.text()}`);
      const config = await json<{ spider?: string; sites?: unknown[] }>(res);
      assert((config.sites?.length ?? 0) > 0, "the config carries no sites");
      const spider = config.spider ?? "";
      assert(spider.startsWith("./a/"), `the spider is not mirrored: ${spider}`);

      // The md5 TVBox checks has to match the bytes it downloads.
      const [path, , md5] = spider.split(";");
      const jar = await fetch(`${baseUrl}/s/${subscriptionToken}/${path!.slice(2)}`);
      assert(jar.status === 200, `the mirrored spider returned ${jar.status}`);
      const got = new Bun.CryptoHasher("md5").update(await jar.arrayBuffer()).digest("hex");
      assert(got === md5, "the mirrored spider does not match its md5");
    },
  },
  {
    name: "a device on no upstream gets the recommendation home and the common entries",
    async run() {
      const common = await call(`${BASE_PATH}/api/tvbox/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sites",
          data: {
            key: "smoke-common",
            name: "Common",
            type: 3,
            api: "csp_Smoke",
          },
        }),
      });
      assert(common.status === 201, `adding a common entry returned ${common.status}`);
      await common.text();
      const published = await call(`${BASE_PATH}/api/tvbox/publishes`, { method: "POST" });
      assert(published.status === 201, `publish returned ${published.status}`);
      await published.text();

      const device = await json<{ data: { token: string } }>(await call(`${BASE_PATH}/api/tvbox/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "common only", upstreamIds: [] }),
      }));
      // The Worker re-reads its device list at most every couple of seconds.
      let res = await fetch(`${baseUrl}/s/${device.data.token}/api.json`);
      for (let i = 0; i < 5 && res.status === 404; i++) {
        await res.text();
        await sleep(1000);
        res = await fetch(`${baseUrl}/s/${device.data.token}/api.json`);
      }
      assert(res.status === 200, `the common-only device returned ${res.status}`);
      const config = await json<{ sites?: { key: string }[] }>(res);
      const keys = (config.sites ?? []).map(s => s.key);
      assert(keys.join() === "bk_home,smoke-common", `the common-only device got ${keys.join()}`);
      // The recommendation home leading the config answers without reaching any chart.
      const home = await fetch(`${baseUrl}/s/${device.data.token}/media/home?wd=x`);
      assert(home.status === 200, `the recommendation home returned ${home.status}`);
      await home.text();
    },
  },
  {
    name: "a TVBox app links through the root enroll path once approved, bound by its device key",
    async run() {
      const report = {
        action: "request",
        code: "SMKE-2345",
        deviceId: "02:00:00:00:00:01",
        name: "smoke tv",
        model: "Smoke Box",
        mode: "leanback",
        abi: "arm64_v8a",
        versionCode: 10002,
        versionName: "1.0.2",
      };
      const enroll = async () => json<{ status: string; subscription?: string; deviceKey?: string }>(await fetch(`${baseUrl}/api/raw/tvbox/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      }));
      assert((await enroll()).status === "pending", "a new code was not pending");

      const list = await json<{ data: { id: string; code: string }[] }>(await call(`${BASE_PATH}/api/tvbox/enrollments`));
      const request = list.data.find(e => e.code === report.code);
      assert(request, "the request is not listed for approval");
      const approved = await call(`${BASE_PATH}/api/tvbox/enrollments/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstreamIds: null }),
      });
      assert(approved.status === 200, `approve returned ${approved.status}`);
      await approved.text();

      const answer = await enroll();
      assert(answer.status === "approved" && answer.subscription, `an approved code answered ${answer.status}`);
      assert(answer.deviceKey, "an app that can send a device key got none");
      const path = new URL(answer.subscription).pathname;
      const asApp = {
        headers: { "X-Device-Id": report.deviceId, "X-Device-Key": answer.deviceKey },
      };
      let res = await fetch(`${baseUrl}${path}`, asApp);
      for (let i = 0; i < 5 && res.status === 404; i++) {
        await res.text();
        await sleep(1000);
        res = await fetch(`${baseUrl}${path}`, asApp);
      }
      assert(res.status === 200, `the handed-out subscription returned ${res.status}`);
      await res.text();
    },
  },
  {
    name: "a wrong subscription token is answered as missing",
    async run() {
      const res = await fetch(`${baseUrl}/s/not-the-token/api.json`);
      assert(res.status === 404, `a wrong token returned ${res.status}`);
      await res.text();
    },
  },
  {
    name: "release registration needs the service token and an uploaded APK",
    async run() {
      const body = JSON.stringify({
        versionCode: 1,
        versionName: "0.0.1",
        assets: [
          {
            mode: "mobile",
            abi: "smoke",
            sha256: "0".repeat(64),
            size: 1,
          },
        ],
      });
      const headers = { "Content-Type": "application/json" };
      // No body: the token is checked first, and an unread body makes the
      // local dev proxy drop the connection the next request reuses.
      const anonymous = await fetch(`${baseUrl}${BASE_PATH}/api/raw/releases`, { method: "POST" });
      assert(anonymous.status === 401, `registration without a token returned ${anonymous.status}`);
      await anonymous.text();

      const missing = await fetch(`${baseUrl}${BASE_PATH}/api/raw/releases`, {
        method: "POST",
        headers: { ...headers, Authorization: `Bearer ${RELEASE_TOKEN}` },
        body,
      });
      assert(missing.status === 422, `registration without an APK returned ${missing.status}`);
      await missing.text();

      const manifest = await fetch(`${baseUrl}/u/stable/mobile-smoke.json`);
      assert(manifest.status === 404, `an unreleased flavor's manifest returned ${manifest.status}`);
      await manifest.text();
    },
  },
  {
    name: "a media series with more than 100 episodes is generated, renumbered and deleted",
    async run() {
      const post = (path: string, body: unknown) => call(`${BASE_PATH}/api${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await post("/media/titles", {
        kind: "series",
        categoryId: "tv",
        title: "smoke series",
        genreIds: ["g18"],
      });
      if (created.status !== 201)
        throw new SmokeError(`create returned ${created.status}: ${await created.text()}`);
      const title = (await json<{ data: { id: number } }>(created)).data;
      const seasons = await json<{ data: { id: number; seasonNumber: number }[] }>(await call(`${BASE_PATH}/api/media/titles/${title.id}/seasons`));
      const season = seasons.data[0]!;
      assert(season.seasonNumber === 1, "a series did not start with season 1");

      const generated = await json<{ data: { count: number } }>(await post(`/media/seasons/${season.id}/episodes/generate`, { from: 1, to: 120 }));
      assert(generated.data.count === 120, `generated ${generated.data.count} episodes`);
      const shifted = await json<{ data: { count: number } }>(await post(`/media/seasons/${season.id}/episodes/shift`, { from: 1, delta: 1 }));
      assert(shifted.data.count === 120, `shifted ${shifted.data.count} episodes`);
      const episodes = await json<{ data: { episodeNumber: number }[] }>(await call(`${BASE_PATH}/api/media/seasons/${season.id}/episodes`));
      assert(episodes.data[0]!.episodeNumber === 2 && episodes.data.at(-1)!.episodeNumber === 121, "episodes were not renumbered");

      const del = await call(`${BASE_PATH}/api/media/titles/${title.id}`, { method: "DELETE" });
      assert(del.status === 200, `delete returned ${del.status}`);
      const gone = await call(`${BASE_PATH}/api/media/seasons/${season.id}`);
      assert(gone.status === 404, `the season outlived its title (${gone.status})`);
    },
  },
  {
    // Publishing projects the library into D1; the Worker answers from it.
    name: "a published movie is served by the media API from D1",
    async run() {
      const post = async (path: string, body: unknown) => {
        const res = await call(`${BASE_PATH}/api${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status !== 201)
          throw new SmokeError(`${path} returned ${res.status}: ${await res.text()}`);
        return (await json<{ data: { id: string | number } }>(res)).data;
      };
      const movie = await post("/media/titles", {
        kind: "movie",
        categoryId: "movie",
        title: "冒烟测试电影",
        releaseDate: "2020-01-01",
        genreIds: ["g28"],
        publishState: "published",
      });
      const source = await post(`/media/titles/${movie.id}/sources`, { name: "smoke", quality: "1080p" });
      await post(`/media/sources/${source.id}/streams`, { url: "https://example.com/smoke.m3u8" });
      await post("/tvbox/entries", {
        kind: "sites",
        data: {
          key: "own_media",
          name: "媒体库",
          type: 1,
          api: "@media/cms",
          mediaApi: "@media/v1",
        },
      });
      const imported = await call(`${BASE_PATH}/api/media/live/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "#EXTM3U\n#EXTINF:-1 group-title=\"冒烟\",Smoke TV\nhttps://example.com/live.m3u8\n" }),
      });
      assert(imported.status === 200, `the live import returned ${imported.status}`);
      await imported.text();
      const published = await call(`${BASE_PATH}/api/tvbox/publishes`, { method: "POST" });
      if (published.status !== 201)
        throw new SmokeError(`publish returned ${published.status}: ${await published.text()}`);
      await published.text();

      const media = (path: string, init?: RequestInit) => fetch(`${baseUrl}/s/${subscriptionToken}/media/v1${path}`, init);
      const manifest = await media("/manifest");
      if (manifest.status !== 200)
        throw new SmokeError(`manifest returned ${manifest.status}: ${await manifest.text()}`);
      const m = await json<{ generation: string; categories: { id: string; count: number }[] }>(manifest);
      assert(m.categories.find(c => c.id === "movie")?.count === 1, "the manifest does not count the movie");

      const page = await json<{ items: { id: string }[] }>(await media("/browse?category=movie&sort=release"));
      assert(page.items.length === 1 && page.items[0]!.id === movie.id, "browse did not list the movie");
      for (const q of ["冒烟测试", "电影"]) {
        const found = await json<{ titles: { id: string }[] }>(await media(`/search?q=${encodeURIComponent(q)}`));
        assert(found.titles.some(t => t.id === movie.id), `searching ${q} did not find the movie`);
      }

      const title = await media(`/titles/${movie.id}`);
      assert(title.status === 200, `the title returned ${title.status}`);
      const etag = title.headers.get("etag");
      assert(etag === `"${m.generation}"`, `the title's ETag ${etag} is not the generation`);
      await title.text();
      const again = await media(`/titles/${movie.id}`, {
        headers: { "If-None-Match": etag },
      });
      assert(again.status === 304, `a matching ETag returned ${again.status}`);
      await again.text();

      // The config names this device's media library; the CMS layer and the playlist answer from D1.
      // The Worker re-reads the published config at most every 30 seconds.
      let site: { key: string; api: string; mediaApi?: string } | undefined;
      for (let i = 0; i < 40 && !site; i++) {
        const config = await json<{ sites?: { key: string; api: string; mediaApi?: string }[] }>(await fetch(`${baseUrl}/s/${subscriptionToken}/api.json`));
        site = config.sites?.find(s => s.key === "own_media");
        if (!site)
          await sleep(1000);
      }
      // Locally `wrangler dev` presents requests under the route's host, so only the path is compared.
      const api = site
        ? new URL(site.api).pathname
        : "";
      assert(api === `/s/${subscriptionToken}/media/cms`, `the media site's api is ${site?.api}`);
      const cms = await json<{ list: { vod_id: string; vod_play_url: string }[] }>(await fetch(`${baseUrl}${api}?ac=detail&ids=${movie.id}`));
      assert(cms.list[0]?.vod_play_url === "正片$https://example.com/smoke.m3u8", `the CMS detail plays ${cms.list[0]?.vod_play_url}`);
      const category = await json<{ total: number; list: { vod_id: string }[] }>(await fetch(`${baseUrl}${api}?ac=detail&t=movie&pg=1`));
      assert(category.total === 1 && category.list[0]?.vod_id === movie.id, `the CMS category lists ${JSON.stringify(category)}`);
      const facets = await json<{ genre: { value: string; count: number }[] }>(await media("/facets?category=movie"));
      assert(facets.genre.some(g => g.value === "g28" && g.count === 1), `the facets are ${JSON.stringify(facets)}`);
      const m3u = await (await fetch(`${baseUrl}/s/${subscriptionToken}/media/live.m3u`)).text();
      assert(m3u.includes("https://example.com/live.m3u8"), "the live playlist lacks the imported channel");

      const playback = await media(`/playback/${movie.id}`);
      assert(playback.headers.get("cache-control") === "no-store", "playback is cacheable");
      const play = await json<{ sources: { streams: { url: string }[] }[] }>(playback);
      assert(play.sources[0]?.streams[0]?.url === "https://example.com/smoke.m3u8", "playback lost the stream");
    },
  },
  {
    // Runs last: it spends whatever creation budget the cases above left.
    name: "creation rate limit is enforced from the database",
    async run() {
      let limited: Response | undefined;
      for (let i = 0; i < 40; i++) {
        const res = await call(`${BASE_PATH}/api/account/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `burst-${i}` }),
        });
        if (res.status === 429) {
          limited = res;
          break;
        }
        await res.text();
      }
      assert(limited !== undefined, "the creation limit never tripped");
      const body = await limited.json() as { error: { code: string } };
      assert(body.error.code === "RATE_LIMITED", `unexpected error code ${body.error.code}`);
      const retryAfter = Number(limited.headers.get("Retry-After"));
      assert(retryAfter > 0, "429 carried no usable Retry-After");
    },
  },
];

const oidcCases: Case[] = [
  {
    name: "health endpoint responds",
    async run() {
      const res = await call(`${BASE_PATH}/api/health`);
      assert(res.status === 200, `health returned ${res.status}`);
    },
  },
  {
    name: "the raw API reaches the Worker and carries no browser headers",
    async run() {
      const res = await fetch(`${baseUrl}${BASE_PATH}/api/raw/health`);
      assert(res.status === 200, `raw health returned ${res.status}`);
      assert((res.headers.get("content-type") ?? "").includes("application/json"), "raw API answered with something other than JSON");
      assert(res.headers.get("content-security-policy") === null, "raw API carries a CSP");
      assert(res.headers.get("cross-origin-resource-policy") === null, "raw API restricts cross-origin readers");
    },
  },
  {
    name: "the site root is the download page",
    async run() {
      const res = await fetch(`${baseUrl}/`);
      assert(res.status === 200, `the download page returned ${res.status}`);
      const body = await res.text();
      assert(body.includes("TVBox 下载"), "the root is not the download page");
    },
  },
  {
    name: "the console SPA is served under its base path, deep links included",
    async run() {
      for (const path of [`${BASE_PATH}/`, `${BASE_PATH}/admin/devices`]) {
        const res = await fetch(`${baseUrl}${path}`);
        assert(res.status === 200, `${path} returned ${res.status}`);
        const body = await res.text();
        assert(body.includes(`src="${BASE_PATH}/assets/`), `${path} is not the console SPA`);
      }
      const asset = await fetch(`${baseUrl}${BASE_PATH}/assets/missing.js`);
      assert(asset.status === 404, `a missing asset returned ${asset.status}`);
      await asset.text();
    },
  },
  {
    name: "login mode reports a configured OAuth provider",
    async run() {
      const res = await call(`${BASE_PATH}/api/account/auth/mode`);
      assert(res.status === 200, `mode returned ${res.status}`);
      const body = await json<{ data: { mode: string; oauthConfigured: boolean } }>(res);
      assert(body.data.mode === "oauth", `mode was '${body.data.mode}', so the SPA would not offer OAuth`);
      // False here means discovery did not resolve the endpoints at boot.
      assert(body.data.oauthConfigured, "the provider's endpoints are not configured");
    },
  },
  {
    name: "starting a login redirects to the issuer with a PKCE challenge",
    async run() {
      const res = await call(`${BASE_PATH}/api/account/auth/login`);
      assert(res.status === 302, `login returned ${res.status}, expected a redirect`);
      const location = res.headers.get("Location");
      assert(location !== null, "the redirect carried no Location");

      const target = new URL(location);
      const issuer = process.env.SMOKE_OAUTH_ISSUER;
      if (issuer)
        assert(target.host === new URL(issuer).host, `redirected to ${target.host}, not the issuer's host`);

      const clientId = process.env.SMOKE_OAUTH_CLIENT_ID;
      if (clientId)
        assert(target.searchParams.get("client_id") === clientId, "the redirect carried a different client_id");

      assert(target.searchParams.get("response_type") === "code", "response_type was not 'code'");
      assert(target.searchParams.get("code_challenge_method") === "S256", "PKCE is not in use: no S256 challenge method");
      assert((target.searchParams.get("code_challenge") ?? "").length > 0, "PKCE is not in use: the challenge is empty");
      assert(
        target.searchParams.get("redirect_uri") === `${baseUrl}${BASE_PATH}/api/account/auth/callback`,
        `redirect_uri was ${target.searchParams.get("redirect_uri")}, which the provider must have registered`,
      );
    },
  },
];

async function waitForBoot(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}${BASE_PATH}/api/health`);
      if (res.ok)
        return;
    }
    catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new SmokeError(`app did not become healthy within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const urlArg = process.argv.indexOf("--url");
  let dev: Subprocess | undefined;

  if (urlArg !== -1) {
    baseUrl = process.argv[urlArg + 1]?.replace(/\/+$/, "") ?? "";
    assert(baseUrl !== "", "--url needs a value");
  }
  else {
    baseUrl = `http://127.0.0.1:${PORT}`;
    // wrangler keeps the Durable Object's SQLite between runs. Start clean so
    // the run is deterministic: a regenerated baseline migration would
    // collide with the old schema, and the rate-limit case needs a fresh
    // creation budget.
    rmSync(new URL("../../apps/api/.wrangler/state", import.meta.url).pathname, {
      recursive: true,
      force: true,
    });
    // The media library is a D1 database.
    const migrated = Bun.spawnSync(
      [
        "./node_modules/.bin/wrangler",
        "d1",
        "migrations",
        "apply",
        "MEDIA",
        "--local",
      ],
      {
        cwd: new URL("../../apps/api", import.meta.url).pathname,
        env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      },
    );
    assert(migrated.exitCode === 0, `migrating the local D1 database failed: ${migrated.stderr.toString()}`);
    dev = Bun.spawn(
      [
        "./node_modules/.bin/wrangler",
        "dev",
        "--port",
        String(PORT),
        "--ip",
        "127.0.0.1",
      ],
      {
        cwd: new URL("../../apps/api", import.meta.url).pathname,
        env: {
          ...process.env,
          CI: "1",
          WRANGLER_SEND_METRICS: "false",
        },
        stdout: process.env.WORKERS_SMOKE_DEBUG ? "inherit" : "pipe",
        stderr: process.env.WORKERS_SMOKE_DEBUG ? "inherit" : "pipe",
      },
    );
  }

  const suite = process.argv.includes("--oidc")
    ? oidcCases
    : cases;

  let failures = 0;
  try {
    await waitForBoot(120_000);
    for (const c of suite) {
      try {
        await c.run();
        console.log(`  ok    ${c.name}`);
      }
      catch (err) {
        failures++;
        console.error(`  FAIL  ${c.name}`);
        console.error(`        ${err instanceof Error
          ? err.message
          : String(err)}`);
      }
    }
  }
  finally {
    dev?.kill();
  }

  console.log(`\n${suite.length - failures}/${suite.length} passed`);
  process.exit(failures === 0
    ? 0
    : 1);
}

await main();
