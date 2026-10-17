import type { MediaDb } from "../db";
import type { ImportTitle } from "./contract";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { listImages } from "../artwork/images.service";
import { listSeasons } from "../catalog/seasons.service";
import { createTitle, getTitle } from "../catalog/titles.service";
import { listCredits } from "../people/people.service";
import { mediaCollections, mediaPeople, mediaTitles } from "../schema";
import { addExternalId, findByExternalId } from "../shared/external-ids";
import { openTestDb } from "../test-db";
import { importTitles } from "./import.service";

let db: MediaDb;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

const nolan = { externalId: "525", name: "克里斯托弗·诺兰", originalName: "Christopher Nolan", profile: "https://img/nolan.jpg" };

const movie: ImportTitle = {
  kind: "movie",
  externalIds: { tmdb: "movie:27205", imdb: "tt1375666" },
  categoryId: "movie",
  title: "盗梦空间",
  originalTitle: "Inception",
  originalLanguage: "en",
  originCountries: ["US", "GB"],
  overview: "道姆·柯布是一名经验老道的窃贼。",
  tagline: "你的思想就是犯罪现场",
  releaseDate: "2010-07-15",
  runtime: 148,
  status: "released",
  contentRating: "PG-13",
  voteAverage: 8.4,
  voteCount: 36000,
  popularity: 95.2,
  publishState: "published",
  origin: "tmdb",
  sort: 7,
  genreIds: ["g28", "g878"],
  translations: [
    { locale: "zh-CN", title: "盗梦空间", overview: "道姆·柯布是一名经验老道的窃贼。", tagline: "你的思想就是犯罪现场" },
    { locale: "en-US", title: "Inception", overview: "Cobb is a skilled thief.", tagline: "Your mind is the scene of the crime." },
  ],
  images: [
    { kind: "poster", url: "https://img/inception-zh.jpg", locale: "zh", width: 500, height: 750 },
    { kind: "backdrop", url: "https://img/inception-bd.jpg", locale: null },
  ],
  collection: null,
  credits: [
    { person: nolan, role: "crew", department: "Directing", job: "Director" },
    { person: { externalId: "6193", name: "莱昂纳多·迪卡普里奥", originalName: "Leonardo DiCaprio", profile: null }, role: "cast", character: "Cobb" },
  ],
};

const series: ImportTitle = {
  kind: "series",
  externalIds: { tmdb: "tv:1396" },
  categoryId: "tv",
  title: "绝命毒师",
  originalTitle: "Breaking Bad",
  originalLanguage: "en",
  originCountries: ["US"],
  releaseDate: "2008-01-20",
  status: "ended",
  voteAverage: 8.9,
  publishState: "published",
  origin: "tmdb",
  genreIds: ["g18"],
  collection: null,
  seasons: [
    { number: 0, name: "特别篇", episodeTotal: 10, airDate: "2009-02-17", poster: "https://img/bb-s0.jpg" },
    { number: 1, name: "第 1 季", overview: "化学老师沃尔特…", episodeTotal: 7, airDate: "2008-01-20", poster: "https://img/bb-s1.jpg" },
    { number: 2, name: "第 2 季", episodeTotal: 13, airDate: "2009-03-08", poster: null },
  ],
  credits: [{ person: { externalId: "66633", name: "文斯·吉里根", originalName: "Vince Gilligan" }, role: "crew", department: "Writing", job: "Creator" }],
};

describe("importing titles", () => {
  test("creates a movie with everything attached", async () => {
    const [r] = await importTitles(db, [movie]);
    expect(r).toMatchObject({ externalId: "movie:27205", action: "created" });
    const t = await getTitle(db, r!.id!);
    expect(t).toMatchObject({ kind: "movie", title: "盗梦空间", originalTitle: "Inception", originCountries: ["US", "GB"], runtime: 148, voteAverage: 8.4, publishState: "published", origin: "tmdb", sort: 7, genreIds: ["g28", "g878"] });
    expect(t.translations.map(x => [x.locale, x.title])).toEqual([["en-US", "Inception"], ["zh-CN", "盗梦空间"]]);
    expect(await findByExternalId(db, "title", "imdb", "tt1375666")).toBe(String(t.id));
    expect((await listImages(db, "title", String(t.id))).map(i => [i.kind, i.url, i.locale, i.isPrimary])).toEqual([
      ["backdrop", "https://img/inception-bd.jpg", null, true],
      ["poster", "https://img/inception-zh.jpg", "zh", true],
    ]);
    const credits = await listCredits(db, t.id);
    expect(credits.map(c => [c.role, c.personName, c.character ?? c.job])).toEqual([["cast", "莱昂纳多·迪卡普里奥", "Cobb"], ["crew", "克里斯托弗·诺兰", "Director"]]);
    const director = credits[1]!;
    expect(await findByExternalId(db, "person", "tmdb", "525")).toBe(String(director.personId));
    expect((await listImages(db, "person", String(director.personId))).map(i => i.url)).toEqual(["https://img/nolan.jpg"]);
  });

  test("creates a series with its seasons (no stray empty season 1) and a collection", async () => {
    const [r] = await importTitles(db, [{ ...series, collection: { externalId: "c1", name: "绝命毒师系列", overview: null } }]);
    const seasons = await listSeasons(db, r!.id!);
    expect(seasons.map(s => [s.seasonNumber, s.name, s.episodeTotal, s.publishState, s.status])).toEqual([
      [0, "特别篇", 10, "published", "ended"],
      [1, "第 1 季", 7, "published", "ended"],
      [2, "第 2 季", 13, "published", "ended"],
    ]);
    expect((await listImages(db, "season", String(seasons[1]!.id))).map(i => i.url)).toEqual(["https://img/bb-s1.jpg"]);
    const t = await getTitle(db, r!.id!);
    expect(t.status).toBe("ended");
    expect(t.collectionId).toBe("tmdb-cc1");
    expect((await db.select().from(mediaCollections).all()).map(c => c.name)).toEqual(["绝命毒师系列"]);
  });

  test("a second run of the same data changes nothing; changed data updates in place", async () => {
    const [first] = await importTitles(db, [movie]);
    const before = await getTitle(db, first!.id!);
    await new Promise(r => setTimeout(r, 5));

    const [same] = await importTitles(db, [movie]);
    expect(same).toMatchObject({ id: first!.id, action: "unchanged" });
    expect((await getTitle(db, first!.id!)).updatedAt).toBe(before.updatedAt);

    const changed: ImportTitle = {
      ...movie,
      voteAverage: 8.5,
      genreIds: ["g28"],
      translations: [movie.translations![1]!],
      images: [...movie.images!, { kind: "poster", url: "https://img/inception-en.jpg", locale: "en" }],
      credits: [movie.credits![0]!],
    };
    const [updated] = await importTitles(db, [changed]);
    expect(updated).toMatchObject({ id: first!.id, action: "updated" });
    const after = await getTitle(db, first!.id!);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after).toMatchObject({ voteAverage: 8.5, genreIds: ["g28"] });
    expect(after.translations.map(x => x.locale)).toEqual(["en-US"]);
    expect((await listImages(db, "title", String(after.id))).filter(i => i.kind === "poster").map(i => [i.url, i.isPrimary])).toEqual([
      ["https://img/inception-zh.jpg", true],
      ["https://img/inception-en.jpg", false],
    ]);
    expect((await listCredits(db, after.id)).map(c => c.personName)).toEqual(["克里斯托弗·诺兰"]);
    expect((await db.select().from(mediaPeople).all()).length).toBe(2);
    expect((await db.select().from(mediaTitles).all()).length).toBe(1);
  });

  test("console edits to category and publish state survive an update; seasons are matched by number", async () => {
    const [r] = await importTitles(db, [series]);
    await db.update(mediaTitles).set({ categoryId: "anime", publishState: "hidden" }).where(eq(mediaTitles.id, r!.id!)).run();
    const [u] = await importTitles(db, [{ ...series, seasons: [{ ...series.seasons![1]!, episodeTotal: 8 }, { number: 3, name: "第 3 季", episodeTotal: 13 }] }]);
    expect(u!.action).toBe("updated");
    expect(await getTitle(db, r!.id!)).toMatchObject({ categoryId: "anime", publishState: "hidden" });
    expect((await listSeasons(db, r!.id!)).map(s => [s.seasonNumber, s.episodeTotal])).toEqual([[0, 10], [1, 8], [2, 13], [3, 13]]);
  });

  test("a title that is not the importer's is skipped; people are shared across titles", async () => {
    const manual = await createTitle(db, { kind: "movie", categoryId: "movie", title: "手工录入" });
    await addExternalId(db, "title", String(manual.id), { source: "tmdb", externalId: "movie:27205" });
    const results = await importTitles(db, [movie, { ...series, credits: [{ person: nolan, role: "cast", character: "本人" }] }]);
    expect(results.map(r => r.action)).toEqual(["skipped", "created"]);
    expect(results[0]!.id).toBe(manual.id);
    expect((await getTitle(db, manual.id)).title).toBe("手工录入");
    expect((await listCredits(db, results[1]!.id!)).map(c => c.personName)).toEqual(["克里斯托弗·诺兰"]);
    expect((await db.select().from(mediaPeople).all()).length).toBe(1);
  });

  test("an unknown genre or a category of the wrong kind rejects that title", async () => {
    await expect(importTitles(db, [{ ...movie, genreIds: ["g999999"] }])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(importTitles(db, [{ ...movie, categoryId: "variety" }])).rejects.toMatchObject({ code: "CATEGORY_KIND_MISMATCH" });
    expect((await db.select().from(mediaTitles).all()).length).toBe(0);
  });
});
