import type { z } from "zod";
import type { MediaDb } from "@/modules/media/db";
import type { DevicesFile } from "@/modules/tvbox/storage";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { addImage } from "@/modules/media/artwork/images.service";
import { createEpisode, listSeasons, updateSeason } from "@/modules/media/catalog/seasons.service";
import { createTitle } from "@/modules/media/catalog/titles.service";
import {
  facetsSchema,
  homeSchema,
  manifestSchema,
  pageSchema,
  personSchema,
  playbackSchema,
  rowSchema,
  searchSchema,
  seasonDetailSchema,
  titleDetailSchema,
} from "@/modules/media/contract";
import { addCredit, createPerson } from "@/modules/media/people/people.service";
import { addStream, createSource } from "@/modules/media/playable/playable.service";
import { markPublished } from "@/modules/media/publish";
import { createRow } from "@/modules/media/taxonomy/rows.service";
import { openTestDb } from "@/modules/media/test-db";
import { DEVICES_KEY } from "@/modules/tvbox/storage";
import { handleMedia } from ".";
import { handleSubscription } from "../subscription";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SHA = "d".repeat(64);
const ASSET_BASE = `https://worker.example/s/${TOKEN}/a/`;

let db: MediaDb;
let dispose: () => void;
beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

async function call(path: string, headers: Record<string, string> = {}) {
  const url = `https://worker.example/s/${TOKEN}/media${path}`;
  // A fresh key each time: the generation is not remembered between calls.
  return await handleMedia({ request: new Request(url, { headers }), db, cacheKey: {}, path: new URL(url).pathname.slice(`/s/${TOKEN}/media`.length), assetBase: ASSET_BASE });
}

async function body<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const res = await call(path);
  expect({ path, status: res.status }).toEqual({ path, status: 200 });
  return schema.parse(await res.json());
}

async function movie(title: string, extra: { year?: number; country?: string; genre?: string; popularity?: number } = {}) {
  const t = await createTitle(db, {
    kind: "movie",
    categoryId: "movie",
    title,
    releaseDate: `${extra.year ?? 2020}-01-01`,
    originCountries: [extra.country ?? "CN"],
    genreIds: [extra.genre ?? "g28"],
    popularity: extra.popularity ?? 0,
    publishState: "published",
  });
  const src = await createSource(db, { titleId: t.id }, { name: "自建" });
  await addStream(db, src.id, { url: `https://v/${t.id}.m3u8` });
  return t;
}

async function library() {
  const a = await movie("流浪地球", { year: 2019, popularity: 30, genre: "g878" });
  const b = await movie("流浪地球2", { year: 2023, popularity: 20, genre: "g878" });
  const c = await movie("Inception", { year: 2010, country: "US", popularity: 10 });
  await addImage(db, "title", String(a.id), { kind: "poster", assetSha256: SHA, assetName: "poster.jpg" });
  const series = await createTitle(db, { kind: "series", categoryId: "tv", title: "漫长的季节", publishState: "published" });
  const season = (await listSeasons(db, series.id))[0]!;
  await updateSeason(db, season.id, { publishState: "published" });
  const e1 = await createEpisode(db, season.id, { episodeNumber: 1 });
  const src = await createSource(db, { seasonId: season.id }, { name: "自建" });
  await addStream(db, src.id, { url: "https://v/s1e1.m3u8", episodeId: e1.id });
  const person = await createPerson(db, { name: "吴京" });
  await addCredit(db, a.id, { personId: person.id, role: "cast", character: "刘培强" });
  await createRow(db, { name: "精选", titleIds: [a.id, b.id, c.id] });
  await markPublished(db);
  return { a, b, c, series, season, e1, person };
}

describe("media v1", () => {
  test("before the first publish there is nothing to serve", async () => {
    const res = await call("/v1/manifest");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_PUBLISHED" } });
  });

  test("manifest, home and a row's next page", async () => {
    const { b, c } = await library();
    const manifest = await body("/v1/manifest", manifestSchema);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.categories.find(x => x.id === "movie")!.count).toBe(3);
    const home = await body("/v1/home", homeSchema);
    const row = home.rows[0]!;
    expect(row.items.length).toBe(3);
    const rest = await body(`/v1/rows/${row.id}?cursor=1&limit=1`, rowSchema);
    expect(rest.items.map(i => i.id)).toEqual([b.id]);
    expect(rest.cursor).toBe("2");
    const last = await body(`/v1/rows/${row.id}?cursor=2&limit=1`, rowSchema);
    expect(last).toMatchObject({ items: [{ id: c.id }], cursor: null });
  });

  test("browse pages by cursor without repeats, in each sort", async () => {
    const { a, b, c } = await library();
    const first = await body("/v1/browse?category=movie&sort=popular&limit=2", pageSchema);
    expect(first.items.map(i => i.id)).toEqual([a.id, b.id]);
    const second = await body(`/v1/browse?category=movie&sort=popular&limit=2&cursor=${first.cursor}`, pageSchema);
    expect(second).toMatchObject({ items: [{ id: c.id }], cursor: null });
    const filtered = await body("/v1/browse?category=movie&genre=g878&year=2023", pageSchema);
    expect(filtered.items.map(i => i.id)).toEqual([b.id]);
    const release = await body("/v1/browse?sort=release", pageSchema);
    expect(release.items.map(i => i.id).slice(0, 2)).toEqual([b.id, a.id]);
  });

  test("facets: counted per category and when narrowed", async () => {
    await library();
    const all = await body("/v1/facets?category=movie", facetsSchema);
    expect(all.country).toEqual([{ value: "CN", label: "中国大陆", count: 2 }, { value: "US", label: "美国", count: 1 }]);
    const narrowed = await body("/v1/facets?category=movie&genre=g878", facetsSchema);
    // Genre counts ignore the genre filter itself; the rest honour it.
    expect(narrowed.genre!.map(g => [g.value, g.count])).toEqual([["g878", 2], ["g28", 1]]);
    expect(narrowed.country).toEqual([{ value: "CN", label: "中国大陆", count: 2 }]);
    expect(narrowed.genre![0]!.label).toBe("科幻");
  });

  test("search finds titles and people by short and long queries", async () => {
    const { a, b, person } = await library();
    const long = await body(`/v1/search?q=${encodeURIComponent("流浪地球")}`, searchSchema);
    expect(long.titles.map(t => t.id).sort()).toEqual([a.id, b.id].sort());
    const short = await body(`/v1/search?q=${encodeURIComponent("吴京")}`, searchSchema);
    expect(short.people).toEqual([expect.objectContaining({ id: person.id, name: "吴京" })]);
    // Titles match by their own names only.
    expect(short.titles).toEqual([]);
    const paged = await body(`/v1/search?q=${encodeURIComponent("流浪地球")}&limit=1`, searchSchema);
    expect(paged.cursor).toBe("1");
    expect((await call("/v1/search?q=")).status).toBe(422);
  });

  test("documents by id, with assets under the device's prefix", async () => {
    const { a, season, e1, person } = await library();
    const title = await body(`/v1/titles/${a.id}`, titleDetailSchema);
    expect(title.images.poster!.url).toBe(`${ASSET_BASE}${SHA}/poster.jpg`);
    expect((await body(`/v1/seasons/${season.id}`, seasonDetailSchema)).episodes.length).toBe(1);
    expect((await body(`/v1/people/${person.id}`, personSchema)).credits[0]!.title.id).toBe(a.id);
    expect((await body(`/v1/playback/${e1.id}`, playbackSchema)).sources[0]!.streams[0]!.url).toBe("https://v/s1e1.m3u8");
    for (const path of [`/v1/seasons/${a.id}`, "/v1/titles/nope", "/v1/seasons/nope", "/v1/collections/x", "/v1/nope", "/v2/manifest"]) {
      const res = await call(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    }
  });

  test("metadata carries the generation as its ETag; playback is never cached", async () => {
    const { a } = await library();
    const res = await call(`/v1/titles/${a.id}`);
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-z]{26}"$/);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect((await call(`/v1/titles/${a.id}`, { "if-none-match": etag })).status).toBe(304);
    const play = await call(`/v1/playback/${a.id}`, { "if-none-match": etag });
    expect(play.status).toBe(200);
    expect(play.headers.get("cache-control")).toBe("no-store");
    expect(play.headers.get("etag")).toBeNull();
  });

  test("the spec documents every endpoint", async () => {
    await library();
    const spec = await (await call("/v1/openapi.json")).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/browse",
      "/collections/{id}",
      "/facets",
      "/home",
      "/live/channels",
      "/manifest",
      "/people/{id}",
      "/playback/{id}",
      "/rows/{id}",
      "/search",
      "/seasons/{id}",
      "/titles/{id}",
    ]);
  });
});

describe("through the subscription", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const devices: DevicesFile = { devices: { [sha(TOKEN)]: { id: "d1", upstreams: null } } };
  const files = { get: async (key: string) => (key === DEVICES_KEY ? new Response(JSON.stringify(devices)) : null) };

  test("a device's token reaches the media API; without a library it is missing", async () => {
    const { a } = await library();
    const url = `https://worker.example/s/${TOKEN}/media/v1/titles/${a.id}`;
    const res = await handleSubscription(new Request(url), { FILES: files }, db);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { images: { poster: { url: string } } }).images.poster.url).toBe(`${ASSET_BASE}${SHA}/poster.jpg`);
    expect((await handleSubscription(new Request(url), { FILES: files })).status).toBe(404);
    expect((await handleSubscription(new Request(url.replace(TOKEN, "f".repeat(32))), { FILES: files }, db)).status).toBe(404);
  });
});
