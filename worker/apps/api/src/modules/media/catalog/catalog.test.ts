import type { MediaDb } from "../db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { addImage, listImages, updateImage } from "../artwork/images.service";
import { mediaEpisodes, mediaExternalIds, mediaImages, mediaSeasons, mediaTitleTranslations } from "../schema";
import { addExternalId, findByExternalId } from "../shared/external-ids";
import { createCategory, deleteCategory, deleteGenre, listCategories, listGenres, updateCategory } from "../taxonomy/taxonomy.service";
import { openTestDb } from "../test-db";
import { createCollection, deleteCollection } from "./collections.service";
import {
  createEpisode,
  createSeason,
  deleteSeason,
  generateEpisodes,
  getSeason,
  listEpisodes,
  listSeasons,
  scheduleEpisodes,
  shiftEpisodes,
  updateSeason,
} from "./seasons.service";
import { createTitle, deleteTitle, getTitle, listTitles, updateTitle } from "./titles.service";
import { deleteTranslation, listTranslations, putTranslation } from "./translations.service";

let db: MediaDb;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

async function series(title = "某剧") {
  return await createTitle(db, { kind: "series", categoryId: "tv", title });
}

describe("taxonomy", () => {
  test("seeds the default categories and TMDB genres once", async () => {
    const categories = await listCategories(db);
    expect(categories.map(c => c.id)).toEqual([
      "movie",
      "tv",
      "anime",
      "variety",
      "documentary",
    ]);
    expect((await listGenres(db)).find(g => g.id === "g18")?.name).toBe("剧情");
  });

  test("a category in use cannot be deleted or drop a kind its titles have", async () => {
    await series();
    await expect(deleteCategory(db, "tv")).rejects.toMatchObject({ code: "CATEGORY_IN_USE" });
    await expect(updateCategory(db, "anime", {
      kinds: ["movie"],
    })).resolves.toMatchObject({
      kinds: ["movie"],
    });
    await createTitle(db, { kind: "series", categoryId: "documentary", title: "纪录" });
    await expect(updateCategory(db, "documentary", {
      kinds: ["movie"],
    })).rejects.toMatchObject({ code: "CATEGORY_IN_USE" });
  });

  test("category ids are unique", async () => {
    await createCategory(db, {
      id: "kids",
      name: "少儿",
      kinds: ["movie", "series"],
    });
    await expect(createCategory(db, {
      id: "kids",
      name: "x",
      kinds: ["movie"],
    })).rejects.toMatchObject({ code: "CATEGORY_EXISTS" });
  });

  test("deleting a genre removes it from titles", async () => {
    const t = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "片",
      genreIds: ["g18", "g28"],
    });
    await deleteGenre(db, "g28");
    expect((await getTitle(db, t.id)).genreIds).toEqual(["g18"]);
  });
});

describe("titles", () => {
  test("a series starts with season 1; a movie has none", async () => {
    const s = await series();
    expect(s.seasonCount).toBe(1);
    expect((await listSeasons(db, s.id))[0]!.seasonNumber).toBe(1);
    const m = await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
    expect(m.seasonCount).toBe(0);
  });

  test("the category must take the kind", async () => {
    await expect(createTitle(db, { kind: "series", categoryId: "movie", title: "x" })).rejects.toMatchObject({ code: "CATEGORY_KIND_MISMATCH" });
  });

  test("unknown genres and collections are rejected", async () => {
    await expect(createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "x",
      genreIds: ["nope"],
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "x",
      collectionId: "nope",
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test("stores genres, aliases and countries; updates replace them", async () => {
    const t = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "让子弹飞",
      originCountries: ["CN", "HK"],
      genreIds: ["g28", "g35"],
      aliases: [
        { name: "Let the Bullets Fly", locale: "en", kind: "translation" },
      ],
    });
    expect(t.originCountries).toEqual(["CN", "HK"]);
    expect(t.genreIds.sort()).toEqual(["g28", "g35"]);
    expect(t.aliases.map(a => a.name)).toEqual(["Let the Bullets Fly"]);
    const u = await updateTitle(db, t.id, {
      genreIds: ["g18"],
      aliases: [],
    });
    expect(u.genreIds).toEqual(["g18"]);
    expect(u.aliases).toEqual([]);
    expect(u.originCountries).toEqual(["CN", "HK"]);
  });

  test("lists by filter and finds titles by alias", async () => {
    await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "甲",
      genreIds: ["g18"],
      aliases: [
        { name: "Alpha" },
      ],
    });
    await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "乙",
      publishState: "published",
    });
    await series("丙");
    expect((await listTitles(db, { page: 1, limit: 10 })).total).toBe(3);
    expect((await listTitles(db, { kind: "movie", page: 1, limit: 10 })).total).toBe(2);
    expect((await listTitles(db, { genreId: "g18", page: 1, limit: 10 })).items.map(t => t.title)).toEqual(["甲"]);
    expect((await listTitles(db, { publishState: "published", page: 1, limit: 10 })).items.map(t => t.title)).toEqual(["乙"]);
    expect((await listTitles(db, { q: "alp", page: 1, limit: 10 })).items.map(t => t.title)).toEqual(["甲"]);
    expect((await listTitles(db, { q: "%", page: 1, limit: 10 })).total).toBe(0);
    const page2 = await listTitles(db, { page: 2, limit: 2 });
    expect(page2.items.length).toBe(1);
    expect(page2.total).toBe(3);
  });

  test("deleting a title removes its seasons, episodes, images and external ids", async () => {
    const s = await series();
    const season = (await listSeasons(db, s.id))[0]!;
    const ep = await createEpisode(db, season.id, { episodeNumber: 1 });
    await addImage(db, "title", String(s.id), { kind: "poster", url: "https://img/p.jpg" });
    await addImage(db, "episode", ep.id, { kind: "still", url: "https://img/s.jpg" });
    await addExternalId(db, "season", String(season.id), { source: "tmdb", externalId: "1-1" });
    await deleteTitle(db, s.id);
    expect(await db.select().from(mediaSeasons).all()).toEqual([]);
    expect(await db.select().from(mediaEpisodes).all()).toEqual([]);
    expect(await db.select().from(mediaImages).all()).toEqual([]);
    expect(await db.select().from(mediaExternalIds).all()).toEqual([]);
  });

  test("ids are random, so the catalogue cannot be counted up", async () => {
    const a = await createTitle(db, { kind: "movie", categoryId: "movie", title: "a" });
    await deleteTitle(db, a.id);
    const b = await createTitle(db, { kind: "movie", categoryId: "movie", title: "b" });
    expect(a.id).toMatch(/^[0-9a-z]{12}$/);
    expect(b.id).toMatch(/^[0-9a-z]{12}$/);
    expect(b.id).not.toBe(a.id);
  });

  test("deleting a collection keeps its titles", async () => {
    const c = await createCollection(db, { name: "哈利·波特（系列）" });
    const t = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "魔法石",
      collectionId: c.id,
    });
    await deleteCollection(db, c.id);
    expect((await getTitle(db, t.id)).collectionId).toBeNull();
  });
});

describe("seasons", () => {
  test("only a series has seasons, and season numbers are unique", async () => {
    const m = await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
    await expect(createSeason(db, m.id, { seasonNumber: 1 })).rejects.toMatchObject({ code: "NOT_A_SERIES" });
    const s = await series();
    await expect(createSeason(db, s.id, { seasonNumber: 1 })).rejects.toMatchObject({ code: "NUMBER_TAKEN" });
    const two = await createSeason(db, s.id, { seasonNumber: 2, name: "第二部" });
    expect(two.sort).toBe(2);
    expect((await listSeasons(db, s.id)).map(x => x.seasonNumber)).toEqual([1, 2]);
  });

  test("the series status follows its published seasons unless locked", async () => {
    const s = await series();
    const one = (await listSeasons(db, s.id))[0]!;
    await updateSeason(db, one.id, { status: "upcoming" });
    expect((await getTitle(db, s.id)).status).toBe("upcoming");
    await updateSeason(db, one.id, { publishState: "published", status: "airing" });
    expect((await getTitle(db, s.id)).status).toBe("returning");
    await updateSeason(db, one.id, { status: "ended" });
    expect((await getTitle(db, s.id)).status).toBe("ended");
    const two = await createSeason(db, s.id, { seasonNumber: 2, status: "upcoming" });
    expect((await getTitle(db, s.id)).status).toBe("ended");
    await updateSeason(db, two.id, { publishState: "published" });
    expect((await getTitle(db, s.id)).status).toBe("returning");
    await updateTitle(db, s.id, { status: "canceled", statusLocked: true });
    await updateSeason(db, two.id, { status: "ended" });
    expect((await getTitle(db, s.id)).status).toBe("canceled");
  });

  test("deleting a season removes its episodes and their images", async () => {
    const s = await series();
    const one = (await listSeasons(db, s.id))[0]!;
    const ep = await createEpisode(db, one.id, { episodeNumber: 1 });
    await addImage(db, "episode", ep.id, { kind: "still", url: "https://img/s.jpg" });
    await deleteSeason(db, one.id);
    expect(await db.select().from(mediaEpisodes).all()).toEqual([]);
    expect(await db.select().from(mediaImages).all()).toEqual([]);
  });
});

describe("episodes", () => {
  async function season() {
    const s = await series();
    return (await listSeasons(db, s.id))[0]!;
  }

  test("episode numbers are unique per season", async () => {
    const one = await season();
    await createEpisode(db, one.id, { episodeNumber: 1 });
    await expect(createEpisode(db, one.id, { episodeNumber: 1 })).rejects.toMatchObject({ code: "NUMBER_TAKEN" });
  });

  test("generates a range, skipping numbers that exist, and counts them", async () => {
    const one = await season();
    await createEpisode(db, one.id, { episodeNumber: 3, name: "已有" });
    expect(await generateEpisodes(db, one.id, 1, 5)).toBe(4);
    expect((await listEpisodes(db, one.id)).map(e => e.episodeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect((await listEpisodes(db, one.id))[2]!.name).toBe("已有");
    await updateSeason(db, one.id, { publishState: "published" });
    const view = await getSeason(db, one.id);
    expect(view.episodeCount).toBe(5);
    expect(view.publishedEpisodeCount).toBe(5);
  });

  test("shifts numbers up to make room, keeping each episode", async () => {
    const one = await season();
    await generateEpisodes(db, one.id, 1, 4);
    const before = await listEpisodes(db, one.id);
    expect(await shiftEpisodes(db, one.id, 2, 1)).toBe(3);
    const after = await listEpisodes(db, one.id);
    expect(after.map(e => e.episodeNumber)).toEqual([1, 3, 4, 5]);
    expect(after.map(e => e.id)).toEqual(before.map(e => e.id));
    await createEpisode(db, one.id, { episodeNumber: 2, name: "补" });
  });

  test("shifting down refuses to collide with earlier episodes", async () => {
    const one = await season();
    await generateEpisodes(db, one.id, 1, 3);
    await expect(shiftEpisodes(db, one.id, 2, -1)).rejects.toMatchObject({ code: "NUMBER_TAKEN" });
    await db.delete(mediaEpisodes).where(eq(mediaEpisodes.episodeNumber, 1)).run();
    expect(await shiftEpisodes(db, one.id, 2, -1)).toBe(2);
    expect((await listEpisodes(db, one.id)).map(e => e.episodeNumber)).toEqual([1, 2]);
  });

  test("schedules weekly air dates", async () => {
    const one = await season();
    await generateEpisodes(db, one.id, 1, 3);
    expect(await scheduleEpisodes(db, one.id, 2, "2026-10-02", 7)).toBe(2);
    expect((await listEpisodes(db, one.id)).map(e => e.airDate)).toEqual([null, "2026-10-02", "2026-10-09"]);
  });
});

describe("images and external ids", () => {
  test("the first image of a kind is primary; promoting another demotes it", async () => {
    const t = await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
    const a = await addImage(db, "title", String(t.id), { kind: "poster", url: "https://img/a.jpg" });
    const b = await addImage(db, "title", String(t.id), { kind: "poster", url: "https://img/b.jpg" });
    const c = await addImage(db, "title", String(t.id), { kind: "backdrop", url: "https://img/c.jpg" });
    expect([a.isPrimary, b.isPrimary, c.isPrimary]).toEqual([true, false, true]);
    await updateImage(db, b.id, { isPrimary: true });
    const images = await listImages(db, "title", String(t.id));
    expect(images.filter(i => i.isPrimary).map(i => i.id).sort()).toEqual([b.id, c.id].sort());
  });

  test("an image needs exactly one of url and asset, and an existing owner", async () => {
    const t = await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
    await expect(addImage(db, "title", String(t.id), { kind: "poster" })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(addImage(db, "title", String(t.id), { kind: "poster", url: "https://x", assetSha256: "ab" })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(addImage(db, "title", "999", { kind: "poster", url: "https://x" })).rejects.toMatchObject({ statusCode: 404 });
  });

  test("an external id links one owner", async () => {
    const a = await createTitle(db, { kind: "movie", categoryId: "movie", title: "a" });
    const b = await createTitle(db, { kind: "movie", categoryId: "movie", title: "b" });
    await addExternalId(db, "title", String(a.id), { source: "tmdb", externalId: "550" });
    await expect(addExternalId(db, "title", String(b.id), { source: "tmdb", externalId: "550" })).rejects.toMatchObject({ code: "EXTERNAL_ID_TAKEN" });
    expect(await findByExternalId(db, "title", "tmdb", "550")).toBe(String(a.id));
  });
});

describe("translations", () => {
  test("one row per locale, replaced on a second put and gone with the title", async () => {
    const t = await createTitle(db, { kind: "movie", categoryId: "movie", title: "盗梦空间" });
    await putTranslation(db, t.id, "en-US", { title: "Inception", overview: "A thief…", tagline: null });
    await putTranslation(db, t.id, "zh-TW", { title: "全面啟動", overview: null, tagline: null });
    await putTranslation(db, t.id, "en-US", { title: "Inception", overview: "A thief who steals secrets", tagline: "Your mind is the scene of the crime" });

    const list = await listTranslations(db, t.id);
    expect(list.map(x => x.locale)).toEqual(["en-US", "zh-TW"]);
    expect(list[0]).toMatchObject({ overview: "A thief who steals secrets", tagline: "Your mind is the scene of the crime" });
    expect((await getTitle(db, t.id)).translations.map(x => x.locale)).toEqual(["en-US", "zh-TW"]);

    await deleteTranslation(db, t.id, "zh-TW");
    expect((await listTranslations(db, t.id)).map(x => x.locale)).toEqual(["en-US"]);
    await expect(deleteTranslation(db, t.id, "zh-TW")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await deleteTitle(db, t.id);
    expect(await db.select().from(mediaTitleTranslations).all()).toEqual([]);
  });
});
