import type { HomeBucket, HomeVod } from "./home";
import { describe, expect, test } from "bun:test";
import { handleHome, parseNetflixTop10, ROWS } from "./home";

interface CmsBody {
  page: number;
  pagecount: number;
  list: HomeVod[];
  class?: { type_id: string; type_name: string }[];
}

function doubanItems(prefix: string, n: number) {
  return {
    total: 60,
    subject_collection_items: Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      title: `${prefix} 片${i}`,
      year: "2026",
      type: prefix === "tv"
        ? "tv"
        : "movie",
      rating: { value: 7.25 },
      pic: { normal: `https://img1.doubanio.com/${prefix}${i}.jpg` },
      episodes_info: i === 0 && prefix === "tv"
        ? "更新至10集"
        : "",
      card_subtitle: "2026 / 中国大陆 / 剧情",
    })),
  };
}

const TSV = [
  "week\tcategory\tweekly_rank\tshow_title\tseason_title\tweekly_hours_viewed",
  "2026-09-27\tTV (English)\t1\tOld Show\tOld Show: Season 1\t1",
  "2026-10-04\tTV (English)\t2\tThe Fixers\tThe Fixers: Season 2\t1",
  "2026-10-04\tTV (Non-English)\t1\tSquid Game\tSquid Game: Season 3\t1",
  "2026-10-04\tTV (English)\t1\tMonster\tMonster: Limited Series\t1",
  "2026-10-04\tFilms (English)\t1\tUNABOMBER\tN/A\t1",
].join("\n");

function fakeFetch(fail = false) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (fail)
      throw new Error("offline");
    const u = new URL(url);
    if (u.host === "m.douban.com") {
      const id = u.pathname.split("/")[5]!;
      return Response.json(doubanItems(id.startsWith("tv")
        ? "tv"
        : "mv", id.includes("real_time")
        ? 2
        : 3));
    }
    if (u.host === "pcw-api.iqiyi.com") {
      const content = u.searchParams.get("pg_num") === "1"
        ? [
            {
              aid: "42",
              title: "把黑夜点燃",
              img: "https://pic.iqiyipic.com/a.jpg",
              tags: "电视剧 / 2026 / 悬疑",
              tuijian: "热度飙升",
            },
          ]
        : [];
      return Response.json({
        data: {
          formatData: {
            data: { content },
          },
        },
      });
    }
    if (u.host === "www.netflix.com")
      return new Response(TSV);
    if (u.host === "api.themoviedb.org") {
      const q = u.searchParams.get("query")!;
      const results = q === "Monster"
        ? []
        : [
            {
              id: q.charCodeAt(0),
              name: `中文 ${q}`,
              poster_path: "/p.jpg",
              first_air_date: "2025-01-01",
              vote_average: 8,
            },
          ];
      return Response.json({ results });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

function memoryCache() {
  const store = new Map<string, string>();
  return {
    store,
    async match(key: string) {
      const v = store.get(key);
      return v === undefined
        ? undefined
        : new Response(v);
    },
    async put(key: string, res: Response) {
      store.set(key, await res.text());
    },
  };
}

function memoryBucket(): HomeBucket & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async get(key) {
      const v = objects.get(key);
      return v === undefined
        ? null
        : {
            text: async () => v,
          };
    },
    async put(key, value) {
      objects.set(key, value);
    },
  };
}

const req = (q = "") => new Request(`https://tv.example/s/tok/media/home${q}`);
const read = async (res: Response) => await res.json() as CmsBody;

describe("recommendation home", () => {
  test("the home lists every row as a class and the realtime chart interleaved, series first", async () => {
    const { impl } = fakeFetch();
    const res = await handleHome(req(), { TMDB_TOKEN: "k" }, {
      fetch: impl,
      cache: memoryCache(),
    });
    const data = await read(res);
    expect(data.class?.map(c => c.type_id)).toEqual(ROWS.map(r => r.id));
    expect(data.list.map(v => v.vod_name)).toEqual(["tv 片0", "mv 片0", "tv 片1", "mv 片1"]);
    expect(data.list[0]).toEqual({
      vod_id: "msearch:db:tv0",
      vod_name: "tv 片0",
      vod_pic: "https://img1.doubanio.com/tv0.jpg@Referer=https://movie.douban.com/",
      vod_remarks: "更新至10集",
      vod_year: "2026",
      vod_content: "2026 / 中国大陆 / 剧情",
      type_name: "剧集",
    });
    expect(data.list[1]!.vod_remarks).toBe("7.3分");
  });

  test("without a TMDB key the Netflix rows are left out", async () => {
    const { impl } = fakeFetch();
    const data = await read(await handleHome(req(), {}, {
      fetch: impl,
      cache: memoryCache(),
    }));
    expect(data.class?.some(c => c.type_id.startsWith("netflix"))).toBe(false);
    expect((await read(await handleHome(req("?t=netflix_tv"), {}, {
      fetch: impl,
      cache: memoryCache(),
    }))).list).toEqual([]);
  });

  test("a Douban row pages through its collection", async () => {
    const { impl, calls } = fakeFetch();
    const data = await read(await handleHome(req("?ac=detail&t=tv&pg=2"), {}, {
      fetch: impl,
      cache: memoryCache(),
    }));
    expect(data.page).toBe(2);
    expect(data.pagecount).toBe(2);
    expect(calls[0]).toContain("/subject_collection/tv_hot/items?start=30&count=30");
  });

  test("the iQiyi chart maps its items and ends at an empty page", async () => {
    const { impl } = fakeFetch();
    const first = await read(await handleHome(req("?t=iqiyi_tv&pg=1"), {}, {
      fetch: impl,
      cache: memoryCache(),
    }));
    expect(first.list).toEqual([
      {
        vod_id: "msearch:iq:42",
        vod_name: "把黑夜点燃",
        vod_pic: "https://pic.iqiyipic.com/a.jpg",
        vod_remarks: "热度飙升",
        vod_year: "2026",
        vod_content: "",
        type_name: "剧集",
      },
    ]);
    expect(first.pagecount).toBe(2);
    const second = await read(await handleHome(req("?t=iqiyi_tv&pg=2"), {}, {
      fetch: impl,
      cache: memoryCache(),
    }));
    expect(second).toMatchObject({ list: [], pagecount: 2 });
  });

  test("Netflix titles are named through TMDB; one TMDB misses is dropped", async () => {
    const { impl, calls } = fakeFetch();
    const data = await read(await handleHome(req("?t=netflix_tv"), { TMDB_TOKEN: "v3key" }, {
      fetch: impl,
      cache: memoryCache(),
    }));
    expect(data.list.map(v => [v.vod_name, v.vod_remarks])).toEqual([
      ["中文 Squid Game", "第3季"],
      ["中文 The Fixers", "第2季"],
    ]);
    expect(data.list[0]!.vod_id).toBe("msearch:tmdb:tv:83");
    expect(data.list[0]!.vod_pic).toBe("https://image.tmdb.org/t/p/w500/p.jpg");
    expect(calls.some(c => c.includes("/search/tv?language=zh-CN&query=Monster&api_key=v3key"))).toBe(true);
  });

  test("a v4 token goes in the authorization header", async () => {
    const headers: (string | null)[] = [];
    const { impl } = fakeFetch();
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("themoviedb"))
        headers.push(new Headers(init?.headers).get("authorization"));
      return impl(input, init);
    }) as typeof fetch;
    await handleHome(req("?t=netflix_movie"), { TMDB_TOKEN: "eyJtoken" }, {
      fetch: spy,
      cache: memoryCache(),
    });
    expect(headers).toEqual(["Bearer eyJtoken"]);
  });

  test("a cached page is not fetched again", async () => {
    const { impl, calls } = fakeFetch();
    const cache = memoryCache();
    await handleHome(req("?t=movie"), {}, { fetch: impl, cache });
    await handleHome(req("?t=movie"), {}, { fetch: impl, cache });
    expect(calls).toHaveLength(1);
  });

  test("when a source fails the last good copy from R2 is served", async () => {
    const bucket = memoryBucket();
    await handleHome(req("?t=movie"), { FILES: bucket }, {
      fetch: fakeFetch().impl,
      cache: memoryCache(),
    });
    expect([
      ...bucket.objects.keys(),
    ]).toEqual(["tvbox/home/movie-1.json"]);

    const stale = await read(await handleHome(req("?t=movie"), { FILES: bucket }, {
      fetch: fakeFetch(true).impl,
      cache: memoryCache(),
    }));
    expect(stale.list).toHaveLength(3);
    const none = await read(await handleHome(req("?t=show"), { FILES: bucket }, {
      fetch: fakeFetch(true).impl,
      cache: memoryCache(),
    }));
    expect(none.list).toEqual([]);
  });

  test("details, search and unknown rows answer empty lists", async () => {
    const { impl, calls } = fakeFetch();
    for (const q of ["?ac=detail&ids=msearch:db:1", "?wd=x", "?t=nope"]) {
      expect((await read(await handleHome(req(q), {}, {
        fetch: impl,
        cache: memoryCache(),
      }))).list).toEqual([]);
    }
    expect(calls).toEqual([]);
  });
});

describe("parseNetflixTop10", () => {
  test("keeps the newest week of a category family, by rank", () => {
    expect(parseNetflixTop10(TSV, "TV")).toEqual([
      { title: "Monster", season: "Monster: Limited Series" },
      { title: "Squid Game", season: "Squid Game: Season 3" },
      { title: "The Fixers", season: "The Fixers: Season 2" },
    ]);
    expect(parseNetflixTop10(TSV, "Films")).toEqual([
      { title: "UNABOMBER", season: "" },
    ]);
  });
});
