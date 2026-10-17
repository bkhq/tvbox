import type { MediaDb } from "@/modules/media/db";
import type { PublishedSnapshot } from "@/modules/tvbox/compose";
import type { DevicesFile } from "@/modules/tvbox/storage";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { addImage } from "@/modules/media/artwork/images.service";
import { createEpisode, createSeason, listSeasons, updateSeason } from "@/modules/media/catalog/seasons.service";
import { createTitle } from "@/modules/media/catalog/titles.service";
import { liveSchema } from "@/modules/media/contract";
import { importM3u } from "@/modules/media/live/live.service";
import { addCredit, createPerson } from "@/modules/media/people/people.service";
import { addStream, createSource } from "@/modules/media/playable/playable.service";
import { projectLibrary } from "@/modules/media/readmodel/projector.service";
import { createSqliteReadModel } from "@/modules/media/readmodel/sqlite-adapter";
import { createRow } from "@/modules/media/taxonomy/rows.service";
import { openTestDb } from "@/modules/media/test-db";
import { DEVICES_KEY, PUBLISHED_KEY } from "@/modules/tvbox/storage";
import { handleMedia } from ".";
import { handleSubscription } from "../subscription";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SHA = "d".repeat(64);
const ASSET_BASE = `https://worker.example/s/${TOKEN}/a/`;

let db: MediaDb;
let dispose: () => void;
let rm: ReturnType<typeof createSqliteReadModel>;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
  rm = createSqliteReadModel();
});

afterEach(() => {
  rm.close();
  dispose();
});

interface CmsBody {
  code: number;
  page: number;
  pagecount: number;
  total: number;
  list: Record<string, string>[];
  class?: { type_id: string; type_name: string }[];
  filters?: Record<string, { key: string; value: { n: string; v: string }[] }[]>;
}

async function cms(query: Record<string, string> = {}): Promise<CmsBody> {
  const url = new URL(`https://worker.example/s/${TOKEN}/media/cms`);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, v);
  const res = await handleMedia({ request: new Request(url), rm, cacheKey: {}, path: "/cms", assetBase: ASSET_BASE });
  expect(res.status).toBe(200);
  return await res.json() as CmsBody;
}

async function movie(title: string, year: number, genre: string, country = "CN") {
  const t = await createTitle(db, { kind: "movie", categoryId: "movie", title, releaseDate: `${year}-01-01`, originCountries: [country], genreIds: [genre], publishState: "published" });
  const src = await createSource(db, { titleId: t.id }, { name: "自建" });
  await addStream(db, src.id, { url: `https://v/${t.id}.m3u8`, resolution: "1080p" });
  return t;
}

async function library() {
  const a = await movie("流浪地球", 2019, "g878");
  const b = await movie("流浪地球2", 2023, "g878");
  const c = await movie("Inception", 2010, "g28", "US");
  await addImage(db, "title", String(a.id), { kind: "poster", assetSha256: SHA, assetName: "poster.jpg" });
  const director = await createPerson(db, { name: "郭帆" });
  await addCredit(db, a.id, { personId: director.id, role: "crew", job: "Director" });

  const series = await createTitle(db, { kind: "series", categoryId: "tv", title: "漫长的季节", publishState: "published" });
  const s1 = (await listSeasons(db, series.id))[0]!;
  await updateSeason(db, s1.id, { publishState: "published", status: "ended", episodeTotal: 2 });
  const s2 = await createSeason(db, series.id, { seasonNumber: 2, publishState: "published" });
  const main = await createSource(db, { seasonId: s1.id }, { name: "自建" });
  const backup = await createSource(db, { seasonId: s1.id }, { name: "自建" });
  for (const n of [1, 2]) {
    const e = await createEpisode(db, s1.id, { episodeNumber: n, ...(n === 2 ? { name: "大结局" } : {}) });
    await addStream(db, main.id, { url: `https://v/s1e${n}.m3u8`, episodeId: e.id });
    if (n === 1)
      await addStream(db, backup.id, { url: `https://b/s1e${n}.m3u8`, episodeId: e.id });
  }
  const s2e1 = await createEpisode(db, s2.id, { episodeNumber: 1 });
  const s2src = await createSource(db, { seasonId: s2.id }, { name: "自建" });
  await addStream(db, s2src.id, { url: "https://v/s2e1.m3u8", episodeId: s2e1.id });

  await createRow(db, { name: "精选", titleIds: [series.id, a.id] });
  await projectLibrary(db, rm, { today: "2026-06-01" });
  return { a, b, c, series, s1, s2 };
}

describe("cms", () => {
  test("home: classes, filters and the first row, a series as its newest season", async () => {
    const { a, s2 } = await library();
    const home = await cms();
    expect(home.code).toBe(1);
    expect(home.class).toEqual([{ type_id: "movie", type_name: "电影" }, { type_id: "tv", type_name: "剧集" }]);
    const movieFilters = home.filters!.movie!;
    expect(movieFilters.map(f => f.key)).toEqual(["genre", "year", "country"]);
    expect(movieFilters[0]!.value[0]).toEqual({ n: "全部", v: "" });
    expect(movieFilters[2]!.value).toContainEqual({ n: "美国", v: "US" });
    expect(home.list.map(v => v.vod_id)).toEqual([s2.id, a.id]);
    expect(home.list[1]!.vod_pic).toBe(`${ASSET_BASE}${SHA}/poster.jpg`);
    expect(home.list[1]!.vod_play_url).toBeUndefined();
  });

  test("a category pages by number and filters by genre, year and country", async () => {
    await library();
    const all = await cms({ ac: "detail", t: "movie", pg: "1" });
    expect({ total: all.total, pagecount: all.pagecount, n: all.list.length }).toEqual({ total: 3, pagecount: 1, n: 3 });
    expect((await cms({ ac: "detail", t: "movie", pg: "1", f: JSON.stringify({ genre: "g878" }) })).total).toBe(2);
    expect((await cms({ ac: "detail", t: "movie", pg: "1", f: JSON.stringify({ genre: "g878", year: "2023" }) })).list.map(v => v.vod_name)).toEqual(["流浪地球2"]);
    expect((await cms({ ac: "detail", t: "movie", pg: "1", f: JSON.stringify({ country: "US" }) })).list.map(v => v.vod_name)).toEqual(["Inception"]);
    expect((await cms({ ac: "detail", t: "movie", pg: "2" })).list).toEqual([]);
  });

  test("details carry the play lists, one flag per source", async () => {
    const { a, s1 } = await library();
    const { list } = await cms({ ac: "detail", ids: `${a.id},${s1.id},nope` });
    expect(list.map(v => v.vod_id)).toEqual([a.id, s1.id]);
    expect(list[0]).toMatchObject({
      vod_name: "流浪地球",
      type_name: "电影",
      vod_year: "2019",
      vod_area: "中国大陆",
      vod_class: "科幻",
      vod_director: "郭帆",
      vod_play_from: "自建",
      vod_play_url: `1080p$https://v/${a.id}.m3u8`,
    });
    expect(list[1]).toMatchObject({
      vod_name: "漫长的季节 第 1 季",
      vod_remarks: "全 2 集",
      vod_play_from: "自建$$$自建2",
      vod_play_url: "第 1 集$https://v/s1e1.m3u8#第 2 集 大结局$https://v/s1e2.m3u8$$$第 1 集$https://b/s1e1.m3u8",
    });
  });

  test("search lists every season of a matching series", async () => {
    const { s1, s2 } = await library();
    const found = await cms({ wd: "漫长的季节" });
    expect(found.list.map(v => v.vod_id)).toEqual([s1.id, s2.id]);
    expect((await cms({ wd: "流浪" })).list.length).toBe(2);
    expect((await cms({ wd: "没有这部" })).list).toEqual([]);
  });
});

describe("live", () => {
  test("published channels are served as M3U and as JSON", async () => {
    await importM3u(db, "#EXTM3U x-tvg-url=\"https://epg/e.xml\"\n#EXTINF:-1 tvg-id=\"C1\" group-title=\"央视\",CCTV1\n#EXTVLCOPT:http-user-agent=ua\nhttps://a/1.m3u8\n");
    await projectLibrary(db, rm, { today: "2026-06-01" });
    const get = (path: string) => handleMedia({ request: new Request(`https://worker.example/s/${TOKEN}/media${path}`), rm, cacheKey: {}, path, assetBase: ASSET_BASE });
    const m3u = await get("/live.m3u");
    expect(m3u.headers.get("content-type")).toContain("mpegurl");
    expect(await m3u.text()).toBe("#EXTM3U x-tvg-url=\"https://epg/e.xml\"\n#EXTINF:-1 tvg-id=\"C1\" tvg-name=\"CCTV1\" group-title=\"央视\",CCTV1\n#EXTVLCOPT:http-user-agent=ua\nhttps://a/1.m3u8\n");
    const live = liveSchema.parse(await (await get("/v1/live/channels")).json());
    expect(live.groups[0]!.channels[0]!.streams[0]).toEqual({ url: "https://a/1.m3u8", label: null, headers: { "User-Agent": "ua" } });
    const manifest = await (await get("/v1/manifest")).json() as { capabilities: { live: boolean } };
    expect(manifest.capabilities.live).toBe(true);
  });
});

describe("the subscription names the media library per device", () => {
  test("@media/ placeholders become the device's absolute media urls", async () => {
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const devices: DevicesFile = { devices: { [sha(TOKEN)]: { id: "d1", upstreams: null } } };
    const snapshot: PublishedSnapshot = {
      version: 2,
      globals: [],
      entries: [
        { id: "1", kind: "sites", upstreamId: null, enabled: true, sort: 0, data: { key: "own_media", type: 1, api: "@media/cms", mediaApi: "@media/v1" } },
        { id: "2", kind: "lives", upstreamId: null, enabled: true, sort: 0, data: { name: "自有直播", url: "@media/live.m3u" } },
      ],
    };
    const objects: Record<string, string> = { [DEVICES_KEY]: JSON.stringify(devices), [PUBLISHED_KEY]: JSON.stringify(snapshot) };
    const files = { get: async (key: string) => (objects[key] === undefined ? null : new Response(objects[key])) };
    const res = await handleSubscription(new Request(`https://worker.example/s/${TOKEN}/api.json`), { FILES: files });
    const config = await res.json() as { sites: Record<string, string>[]; lives: Record<string, string>[] };
    const base = `https://worker.example/s/${TOKEN}/media`;
    expect(config.sites[1]).toMatchObject({ api: `${base}/cms`, mediaApi: `${base}/v1` });
    expect(config.lives[0]!.url).toBe(`${base}/live.m3u`);
  });
});
