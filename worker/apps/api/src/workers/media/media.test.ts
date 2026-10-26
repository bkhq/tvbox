import type { z } from "zod";
import type { MediaDb } from "@/modules/media/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addImage } from "@/modules/media/artwork/images.service";
import { createEpisode, listSeasons, updateSeason } from "@/modules/media/catalog/seasons.service";
import { createTitle, updateTitle } from "@/modules/media/catalog/titles.service";
import { createChannel, createClient, rotateClientToken, updateClient } from "@/modules/media/clients/clients.service";
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
import { createRow } from "@/modules/media/taxonomy/rows.service";
import { openTestDb } from "@/modules/media/test-db";
import { handleMedia } from ".";
import { handleSubscription } from "../subscription";

const SHA = "d".repeat(64);
const files = {
  get: async (key: string) => (key.includes(SHA)
    ? { body: new Response("png").body }
    : null),
};

let db: MediaDb;
let dispose: () => void;
let channel: string;
let token: string;
beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
  channel = (await createChannel(db, { name: "main" })).id;
  ({ token } = await createClient(db, {
    name: "box",
    channelIds: [channel],
  }));
});

afterEach(() => dispose());

const assetBase = () => `https://worker.example/m/${token}/a/`;

async function call(path: string, headers: Record<string, string> = {}, as = token, method = "GET") {
  return await handleMedia(new Request(`https://worker.example/m/${as}${path}`, { headers, method }), { FILES: files }, db);
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
    public: true,
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
  const series = await createTitle(db, {
    kind: "series",
    categoryId: "tv",
    title: "漫长的季节",
    publishState: "published",
    public: true,
  });
  const season = (await listSeasons(db, series.id))[0]!;
  await updateSeason(db, season.id, { publishState: "published" });
  const e1 = await createEpisode(db, season.id, { episodeNumber: 1 });
  const src = await createSource(db, { seasonId: season.id }, { name: "自建" });
  await addStream(db, src.id, { url: "https://v/s1e1.m3u8", episodeId: e1.id });
  const person = await createPerson(db, { name: "吴京" });
  await addCredit(db, a.id, { personId: person.id, role: "cast", character: "刘培强" });
  await createRow(db, {
    name: "精选",
    titleIds: [a.id, b.id, c.id],
  });
  return { a, b, c, series, season, e1, person };
}

describe("media v1", () => {
  test("an empty library is served before anything is published", async () => {
    const manifest = await body("/v1/manifest", manifestSchema);
    expect(manifest.categories.every(x => x.count === 0)).toBe(true);
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
    expect(last).toMatchObject({
      items: [
        { id: c.id },
      ],
      cursor: null,
    });
  });

  test("browse pages by cursor without repeats, in each sort", async () => {
    const { a, b, c } = await library();
    const first = await body("/v1/browse?category=movie&sort=popular&limit=2", pageSchema);
    expect(first.items.map(i => i.id)).toEqual([a.id, b.id]);
    const second = await body(`/v1/browse?category=movie&sort=popular&limit=2&cursor=${first.cursor}`, pageSchema);
    expect(second).toMatchObject({
      items: [
        { id: c.id },
      ],
      cursor: null,
    });
    const filtered = await body("/v1/browse?category=movie&genre=g878&year=2023", pageSchema);
    expect(filtered.items.map(i => i.id)).toEqual([b.id]);
    const release = await body("/v1/browse?sort=release", pageSchema);
    expect(release.items.map(i => i.id).slice(0, 2)).toEqual([b.id, a.id]);
  });

  test("facets: counted per category and when narrowed", async () => {
    await library();
    const all = await body("/v1/facets?category=movie", facetsSchema);
    expect(all.country).toEqual([
      { value: "CN", label: "中国大陆", count: 2 },
      { value: "US", label: "美国", count: 1 },
    ]);
    const narrowed = await body("/v1/facets?category=movie&genre=g878", facetsSchema);
    // Genre counts ignore the genre filter itself; the rest honour it.
    expect(narrowed.genre!.map(g => [g.value, g.count])).toEqual([
      ["g878", 2],
      ["g28", 1],
    ]);
    expect(narrowed.country).toEqual([
      { value: "CN", label: "中国大陆", count: 2 },
    ]);
    expect(narrowed.genre![0]!.label).toBe("科幻");
  });

  test("search finds titles and people by short and long queries", async () => {
    const { a, b, person } = await library();
    const long = await body(`/v1/search?q=${encodeURIComponent("流浪地球")}`, searchSchema);
    expect(long.titles.map(t => t.id).sort()).toEqual([a.id, b.id].sort());
    const short = await body(`/v1/search?q=${encodeURIComponent("吴京")}`, searchSchema);
    expect(short.people).toEqual([
      expect.objectContaining({ id: person.id, name: "吴京" }),
    ]);
    // Titles match by their own names only.
    expect(short.titles).toEqual([]);
    const paged = await body(`/v1/search?q=${encodeURIComponent("流浪地球")}&limit=1`, searchSchema);
    expect(paged.cursor).toBe("1");
    expect((await call("/v1/search?q=")).status).toBe(422);
  });

  test("documents by id, with assets under the client's prefix", async () => {
    const { a, season, e1, person } = await library();
    const title = await body(`/v1/titles/${a.id}`, titleDetailSchema);
    expect(title.images.poster!.url).toBe(`${assetBase()}${SHA}/poster.jpg`);
    expect((await body(`/v1/seasons/${season.id}`, seasonDetailSchema)).episodes.length).toBe(1);
    expect((await body(`/v1/people/${person.id}`, personSchema)).credits[0]!.title.id).toBe(a.id);
    expect((await body(`/v1/playback/${e1.id}`, playbackSchema)).sources[0]!.streams[0]!.url).toBe("https://v/s1e1.m3u8");
    for (const path of [
      `/v1/seasons/${a.id}`,
      "/v1/titles/nope",
      "/v1/seasons/nope",
      "/v1/collections/x",
      "/v1/nope",
      "/v2/manifest",
    ]) {
      const res = await call(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(await res.json()).toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    }
  });

  test("metadata carries the generation as its ETag; playback is never cached", async () => {
    const { a } = await library();
    const res = await call(`/v1/titles/${a.id}`);
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"0\.[0-9a-f]{12}"$/);
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

describe("client urls", () => {
  test("unknown, disabled and rotated tokens are not found; only reads are allowed", async () => {
    await library();
    expect((await call("/v1/manifest", {}, "f".repeat(32))).status).toBe(404);
    expect((await handleMedia(new Request("https://worker.example/m/"), {}, db)).status).toBe(404);
    expect((await call("/v1/manifest", {}, token, "POST")).status).toBe(405);

    const other = await createClient(db, {
      name: "off",
      channelIds: [channel],
    });
    await updateClient(db, other.id, { enabled: false });
    expect((await call("/v1/manifest", {}, other.token)).status).toBe(404);

    const third = await createClient(db, {
      name: "rotated",
      channelIds: [channel],
    });
    const rotated = await rotateClientToken(db, third.id);
    expect((await call("/v1/manifest", {}, third.token)).status).toBe(404);
    expect((await call("/v1/manifest", {}, rotated.token)).status).toBe(200);
  });

  test("assets are served by content hash", async () => {
    const res = await call(`/a/${SHA}/poster.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("png");
    expect((await call(`/a/${"e".repeat(64)}/x.png`)).status).toBe(404);
    expect((await call("/a/nope")).status).toBe(404);
  });

  test("a title is seen when public or in one of the client's channels", async () => {
    const { a, b, c, person } = await library();
    const vip = (await createChannel(db, { name: "vip" })).id;
    const elsewhere = (await createChannel(db, { name: "elsewhere" })).id;
    await updateTitle(db, a.id, {
      public: false,
      channelIds: [vip],
    });
    await updateTitle(db, b.id, {
      public: false,
      channelIds: [channel],
    });
    await updateTitle(db, c.id, { public: false });
    const insider = (await createClient(db, {
      name: "insider",
      channelIds: [elsewhere, vip],
    })).token;

    const ids = async (as: string) => pageSchema.parse(await (await call("/v1/browse?category=movie", {}, as)).json()).items.map(i => i.id).sort();
    expect(await ids(token)).toEqual([b.id]);
    expect(await ids(insider)).toEqual([a.id]);
    expect((await call(`/v1/titles/${a.id}`)).status).toBe(404);
    expect((await call(`/v1/titles/${a.id}`, {}, insider)).status).toBe(200);
    expect((await call(`/v1/titles/${c.id}`, {}, insider)).status).toBe(404);
    expect(searchSchema.parse(await (await call(`/v1/search?q=${encodeURIComponent("流浪地球")}`)).json()).titles.map(t => t.id)).toEqual([b.id]);
    expect(facetsSchema.parse(await (await call("/v1/facets?category=movie")).json()).country).toEqual([
      { value: "CN", label: "中国大陆", count: 1 },
    ]);
    expect(manifestSchema.parse(await (await call("/v1/manifest")).json()).categories.find(x => x.id === "movie")!.count).toBe(1);
    expect((await call(`/v1/people/${person.id}`)).status).toBe(404);
    expect(personSchema.parse(await (await call(`/v1/people/${person.id}`, {}, insider)).json()).credits[0]!.title.id).toBe(a.id);
    const cms = async (as: string) => (await (await call("/cms?ac=detail&t=movie&pg=1", {}, as)).json() as { list: { vod_id: string }[] }).list.map(v => v.vod_id);
    expect(await cms(token)).toEqual([b.id]);
    expect(await cms(insider)).toEqual([a.id]);
  });

  test("the shared cache is keyed by channels, not by client", async () => {
    const { a } = await library();
    const keys: string[] = [];
    const store = new Map<string, { body: string; headers: Headers }>();
    const g = globalThis as { caches?: unknown };
    g.caches = {
      default: {
        match: async (key: string) => (store.has(key)
          ? new Response(store.get(key)!.body, { headers: store.get(key)!.headers })
          : undefined),
        put: async (key: string, res: Response) => {
          keys.push(key);
          store.set(key, { body: await res.text(), headers: res.headers });
        },
      },
    };
    try {
      const twin = (await createClient(db, {
        name: "twin",
        channelIds: [channel],
      })).token;
      const vip = (await createChannel(db, { name: "vip" })).id;
      const other = (await createClient(db, {
        name: "other",
        channelIds: [vip],
      })).token;
      for (const as of [token, twin, other])
        expect((await call(`/v1/titles/${a.id}`, {}, as)).status).toBe(200);
      expect(keys.length).toBe(2);
      expect(keys.every(k => !k.includes(token) && !k.includes(twin))).toBe(true);
      // Served from the cache, the assets still name the client's own prefix.
      const twinTitle = titleDetailSchema.parse(await (await call(`/v1/titles/${a.id}`, {}, twin)).json());
      expect(twinTitle.images.poster!.url).toBe(`https://worker.example/m/${twin}/a/${SHA}/poster.jpg`);
      expect(keys.length).toBe(2);
    }
    finally {
      delete g.caches;
    }
  });

  test("the subscription no longer serves the library", async () => {
    const res = await handleSubscription(new Request(`https://worker.example/s/${token}/media/v1/manifest`), {
      FILES: {
        get: async () => null,
      },
    });
    expect(res.status).toBe(404);
  });
});
