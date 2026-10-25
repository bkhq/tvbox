import type { TmdbMovie, TmdbTv } from "./tmdb";
import { describe, expect, test } from "bun:test";
import { importTitleSchema } from "../../apps/api/src/modules/media/import/contract";
import { DEFAULT_FALLBACK, DEFAULT_LOCALES, mapMovie, mapTv, pool, rankedIds, tmdbClient } from "./tmdb";

const opts = {
  locales: DEFAULT_LOCALES,
  fallback: DEFAULT_FALLBACK,
  cast: 2,
  rank: 3,
};

const nolan = {
  id: 525,
  name: "克里斯托弗·诺兰",
  original_name: "Christopher Nolan",
  profile_path: "/nolan.jpg",
};

const inception: TmdbMovie = {
  id: 27205,
  title: "盗梦空间",
  original_title: "Inception",
  original_language: "en",
  overview: "道姆·柯布是一名经验老道的窃贼。",
  tagline: "",
  release_date: "2010-07-15",
  runtime: 148,
  status: "Released",
  adult: false,
  vote_average: 8.369,
  vote_count: 36000,
  popularity: 95.2,
  poster_path: "/zh.jpg",
  backdrop_path: "/bd.jpg",
  genres: [
    { id: 28, name: "动作" },
    { id: 878, name: "科幻" },
  ],
  production_countries: [
    { iso_3166_1: "GB" },
    { iso_3166_1: "US" },
  ],
  origin_country: ["US", "GB"],
  belongs_to_collection: null,
  translations: {
    translations: [
      {
        iso_639_1: "zh",
        iso_3166_1: "CN",
        data: { title: "盗梦空间", overview: "道姆·柯布是一名经验老道的窃贼。", tagline: "" },
      },
      {
        iso_639_1: "en",
        iso_3166_1: "US",
        data: { title: "Inception", overview: "Cobb is a skilled thief.", tagline: "Your mind is the scene of the crime." },
      },
      {
        iso_639_1: "fr",
        iso_3166_1: "FR",
        data: { title: "Inception", overview: "Dom Cobb…" },
      },
    ],
  },
  credits: {
    cast: [
      {
        id: 2,
        name: "约瑟夫·高登-莱维特",
        original_name: "Joseph Gordon-Levitt",
        profile_path: null,
        character: "Arthur",
        order: 1,
      },
      {
        id: 6193,
        name: "莱昂纳多·迪卡普里奥",
        original_name: "Leonardo DiCaprio",
        profile_path: "/leo.jpg",
        character: "Cobb",
        order: 0,
      },
      {
        id: 3,
        name: "渡边谦",
        original_name: "Ken Watanabe",
        profile_path: null,
        character: "Saito",
        order: 2,
      },
    ],
    crew: [
      { ...nolan, department: "Directing", job: "Director" },
      { ...nolan, department: "Writing", job: "Writer" },
      {
        id: 9,
        name: "Hans Zimmer",
        original_name: "Hans Zimmer",
        profile_path: null,
        department: "Sound",
        job: "Original Music Composer",
      },
    ],
  },
  images: {
    posters: [
      {
        file_path: "/zh.jpg",
        iso_639_1: "zh",
        width: 500,
        height: 750,
      },
    ],
    backdrops: [
      {
        file_path: "/bd.jpg",
        iso_639_1: null,
        width: 1920,
        height: 1080,
      },
    ],
  },
  external_ids: { imdb_id: "tt1375666" },
  release_dates: {
    results: [
      {
        iso_3166_1: "DE",
        release_dates: [
          { certification: "12" },
        ],
      },
      {
        iso_3166_1: "US",
        release_dates: [
          { certification: "" },
          { certification: "PG-13" },
        ],
      },
    ],
  },
};

const breakingBad: TmdbTv = {
  id: 1396,
  name: "Breaking Bad",
  original_name: "Breaking Bad",
  original_language: "en",
  overview: "",
  adult: false,
  vote_average: 8.9,
  vote_count: 15000,
  popularity: 400,
  poster_path: "/bb.jpg",
  backdrop_path: null,
  first_air_date: "2008-01-20",
  episode_run_time: [45],
  status: "Ended",
  origin_country: ["US"],
  genres: [
    { id: 18, name: "剧情" },
    { id: 80, name: "犯罪" },
  ],
  created_by: [
    {
      id: 66633,
      name: "文斯·吉里根",
      original_name: "Vince Gilligan",
      profile_path: null,
    },
  ],
  seasons: [
    {
      season_number: 0,
      name: "特别篇",
      overview: "",
      air_date: "2009-02-17",
      episode_count: 10,
      poster_path: "/s0.jpg",
    },
    {
      season_number: 1,
      name: "第 1 季",
      overview: "化学老师…",
      air_date: "2008-01-20",
      episode_count: 7,
      poster_path: null,
    },
  ],
  translations: {
    translations: [
      {
        iso_639_1: "zh",
        iso_3166_1: "CN",
        data: { name: "", overview: "" },
      },
      {
        iso_639_1: "zh",
        iso_3166_1: "TW",
        data: { name: "絕命毒師", overview: "" },
      },
      {
        iso_639_1: "en",
        iso_3166_1: "US",
        data: { name: "Breaking Bad", overview: "A chemistry teacher…", tagline: "All Hail the King" },
      },
    ],
  },
  aggregate_credits: {
    cast: [
      {
        id: 17419,
        name: "布莱恩·科兰斯顿",
        original_name: "Bryan Cranston",
        profile_path: "/bc.jpg",
        roles: [
          { character: "Walter White" },
        ],
        order: 0,
      },
    ],
    crew: [
      {
        id: 66633,
        name: "文斯·吉里根",
        original_name: "Vince Gilligan",
        profile_path: null,
        department: "Writing",
        jobs: [
          { job: "Writer" },
          { job: "Executive Producer" },
        ],
      },
    ],
  },
  images: { posters: [], backdrops: [] },
  external_ids: { imdb_id: "tt0903747", tvdb_id: 81189 },
  content_ratings: {
    results: [
      { iso_3166_1: "US", rating: "TV-MA" },
    ],
  },
};

describe("mapping TMDB details", () => {
  test("a movie with a Chinese translation", () => {
    const { title, resolved } = mapMovie(inception, opts);
    expect(importTitleSchema.safeParse(title).success).toBe(true);
    expect(resolved).toEqual({ title: "zh-CN", overview: "zh-CN" });
    expect(title).toMatchObject({
      kind: "movie",
      externalIds: { tmdb: "movie:27205", imdb: "tt1375666" },
      categoryId: "movie",
      title: "盗梦空间",
      originalTitle: "Inception",
      originCountries: ["US", "GB"],
      tagline: "Your mind is the scene of the crime.",
      releaseDate: "2010-07-15",
      runtime: 148,
      status: "released",
      contentRating: "PG-13",
      voteAverage: 8.369,
      publishState: "published",
      origin: "tmdb",
      sort: 3,
      genreIds: ["g28", "g878"],
    });
    expect(title.translations!.map(t => t.locale)).toEqual(["zh-CN", "en-US"]);
    expect(title.images).toEqual([
      {
        kind: "poster",
        url: "https://image.tmdb.org/t/p/w500/zh.jpg",
        locale: "zh",
        width: 500,
        height: 750,
      },
      {
        kind: "backdrop",
        url: "https://image.tmdb.org/t/p/w1280/bd.jpg",
        locale: null,
        width: 1920,
        height: 1080,
      },
    ]);
    expect(title.credits!.map(c => [c.role, c.person.externalId, c.job ?? c.character])).toEqual([
      ["crew", "525", "Director"],
      ["cast", "6193", "Cobb"],
      ["cast", "2", "Arthur"],
    ]);
    expect(title.credits![0]!.person).toEqual({
      externalId: "525",
      name: "克里斯托弗·诺兰",
      originalName: "Christopher Nolan",
      profile: "https://image.tmdb.org/t/p/w185/nolan.jpg",
    });
  });

  test("a series falls back through the chain and keeps its seasons", () => {
    const { title, resolved } = mapTv(breakingBad, opts);
    expect(importTitleSchema.safeParse(title).success).toBe(true);
    expect(resolved).toEqual({ title: "zh-TW", overview: "en-US" });
    expect(title).toMatchObject({
      kind: "series",
      externalIds: { tmdb: "tv:1396", imdb: "tt0903747", tvdb: "81189" },
      categoryId: "tv",
      title: "絕命毒師",
      overview: "A chemistry teacher…",
      tagline: "All Hail the King",
      releaseDate: "2008-01-20",
      runtime: 45,
      status: "ended",
      contentRating: "TV-MA",
      collection: null,
    });
    expect(title.translations).toEqual([
      {
        locale: "en-US",
        title: "Breaking Bad",
        overview: "A chemistry teacher…",
        tagline: "All Hail the King",
      },
    ]);
    expect(title.seasons).toEqual([
      {
        number: 0,
        name: "特别篇",
        overview: null,
        airDate: "2009-02-17",
        episodeTotal: 10,
        poster: "https://image.tmdb.org/t/p/w500/s0.jpg",
      },
      {
        number: 1,
        name: "第 1 季",
        overview: "化学老师…",
        airDate: "2008-01-20",
        episodeTotal: 7,
        poster: null,
      },
    ]);
    expect(title.credits!.map(c => [c.role, c.person.externalId, c.job ?? c.character])).toEqual([
      ["crew", "66633", "Creator"],
      ["cast", "17419", "Walter White"],
    ]);
  });

  test("categories follow the genres; nothing translated falls back to the original", () => {
    const anime = mapTv({
      ...breakingBad,
      genres: [
        { id: 16, name: "动画" },
      ],
      translations: { translations: [] },
    }, opts);
    expect(anime.title).toMatchObject({
      categoryId: "anime",
      title: "Breaking Bad",
      overview: null,
      translations: [],
    });
    expect(anime.resolved).toEqual({ title: "original", overview: null });
    expect(mapTv({
      ...breakingBad,
      genres: [
        { id: 10764, name: "真人秀" },
      ],
    }, opts).title.categoryId).toBe("variety");
    expect(mapMovie({
      ...inception,
      genres: [
        { id: 99, name: "纪录" },
      ],
      status: "Post Production",
      release_dates: { results: [] },
    }, opts).title).toMatchObject({ categoryId: "documentary", status: "upcoming", contentRating: null });
  });
});

describe("ranked ids", () => {
  test("walks the pages from the last to the first, each reversed, and stops at the count", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      calls.push(`${u.pathname}?page=${u.searchParams.get("page")}&votes=${u.searchParams.get("vote_count.gte")}&key=${u.searchParams.get("api_key")}`);
      const page = Number(u.searchParams.get("page"));
      return Response.json({
        page,
        total_pages: 500,
        results: Array.from({ length: 20 }, (_, i) => ({ id: (page - 1) * 20 + i + 1 })),
      });
    };
    const ids = await rankedIds(tmdbClient("v3key", fetchImpl), "movie", { count: 45, minVotes: 300, language: "zh-CN" });
    expect(calls).toEqual(["/3/discover/movie?page=3&votes=300&key=v3key", "/3/discover/movie?page=2&votes=300&key=v3key", "/3/discover/movie?page=1&votes=300&key=v3key"]);
    expect(ids.length).toBe(45);
    expect(ids.slice(0, 3)).toEqual([
      { id: 45, rank: 45 },
      { id: 44, rank: 44 },
      { id: 43, rank: 43 },
    ]);
    expect(ids.at(-1)).toEqual({ id: 1, rank: 1 });
  });

  test("a v4 token goes in the header; 429 waits for Retry-After and retries", async () => {
    const seen: { auth: string | null; key: string | null }[] = [];
    const waits: number[] = [];
    let first = true;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({
        auth: new Headers(init?.headers).get("authorization"),
        key: new URL(url).searchParams.get("api_key"),
      });
      if (first) {
        first = false;
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return Response.json({ ok: true });
    };
    const call = tmdbClient("eyJabc", fetchImpl, async ms => void waits.push(ms));
    expect(await call("/movie/1")).toEqual({ ok: true });
    expect(seen).toEqual([
      { auth: "Bearer eyJabc", key: null },
      { auth: "Bearer eyJabc", key: null },
    ]);
    expect(waits).toEqual([2000]);
  });

  test("pool keeps the order and the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await pool([30, 10, 20], 2, async (ms) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(r => setTimeout(r, ms));
      inFlight--;
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
    expect(peak).toBe(2);
  });
});
