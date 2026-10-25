import type { MediaDb } from "../db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createEpisode, deleteEpisode, generateEpisodes, listEpisodes, listSeasons } from "../catalog/seasons.service";
import { createTitle, deleteTitle } from "../catalog/titles.service";
import { addCredit, createPerson, deletePerson, listCredits, personCredits, updateCredit } from "../people/people.service";
import { mediaStreams, mediaTitles } from "../schema";
import { createRow, getHero, listRows, setHero, updateRow } from "../taxonomy/rows.service";
import { openTestDb } from "../test-db";
import { addStream, createSource, deleteSource, deleteStream, listSources, listStreams, pasteStreams, updateSource, updateStream } from "./playable.service";

let db: MediaDb;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

async function movie() {
  return await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
}

async function seasonOne() {
  const s = await createTitle(db, { kind: "series", categoryId: "tv", title: "剧" });
  return { title: s, season: (await listSeasons(db, s.id))[0]! };
}

describe("sources", () => {
  test("a movie's sources hang on the title, a series' on its seasons", async () => {
    const m = await movie();
    const { title, season } = await seasonOne();
    await createSource(db, { titleId: m.id }, { name: "自建" });
    await expect(createSource(db, { titleId: title.id }, { name: "x" })).rejects.toMatchObject({ code: "SOURCE_OWNER_MISMATCH" });
    const s = await createSource(db, { seasonId: season.id }, { name: "4K", quality: "2160p" });
    expect(s.sort).toBe(0);
    expect((await createSource(db, { seasonId: season.id }, { name: "备用" })).sort).toBe(1);
    expect((await listSources(db, { seasonId: season.id })).map(x => x.name)).toEqual(["4K", "备用"]);
  });

  test("a movie stream has no episode; a season stream needs one of its season", async () => {
    const m = await movie();
    const ms = await createSource(db, { titleId: m.id }, { name: "自建" });
    const stream = await addStream(db, ms.id, { url: "https://v/a.mp4" });
    expect(stream.format).toBe("mp4");

    const { season } = await seasonOne();
    const other = await seasonOne();
    const ep = await createEpisode(db, season.id, { episodeNumber: 1 });
    const foreign = await createEpisode(db, other.season.id, { episodeNumber: 1 });
    const ss = await createSource(db, { seasonId: season.id }, { name: "自建" });
    await expect(addStream(db, ms.id, { url: "https://v/a.m3u8", episodeId: ep.id })).rejects.toMatchObject({ code: "EPISODE_MISMATCH" });
    await expect(addStream(db, ss.id, { url: "https://v/a.m3u8" })).rejects.toMatchObject({ code: "EPISODE_MISMATCH" });
    await expect(addStream(db, ss.id, { url: "https://v/a.m3u8", episodeId: foreign.id })).rejects.toMatchObject({ code: "EPISODE_MISMATCH" });
    await addStream(db, ss.id, { url: "https://v/a.m3u8", episodeId: ep.id });
  });

  test("streams go with their episode, their source and their title", async () => {
    const { title, season } = await seasonOne();
    const [e1, e2] = [await createEpisode(db, season.id, { episodeNumber: 1 }), await createEpisode(db, season.id, { episodeNumber: 2 })];
    const src = await createSource(db, { seasonId: season.id }, { name: "自建" });
    await addStream(db, src.id, { url: "https://v/1.m3u8", episodeId: e1.id });
    await addStream(db, src.id, { url: "https://v/2.m3u8", episodeId: e2.id });
    await deleteEpisode(db, e1.id);
    expect((await listStreams(db, src.id)).length).toBe(1);
    await deleteSource(db, src.id);
    expect(await db.select().from(mediaStreams).all()).toEqual([]);
    const again = await createSource(db, { seasonId: season.id }, { name: "自建" });
    await addStream(db, again.id, { url: "https://v/2.m3u8", episodeId: e2.id });
    await deleteTitle(db, title.id);
    expect(await db.select().from(mediaStreams).all()).toEqual([]);
  });
});

describe("pasting streams", () => {
  test("a dry run previews the alignment without writing", async () => {
    const { season } = await seasonOne();
    await generateEpisodes(db, season.id, 1, 2);
    const src = await createSource(db, { seasonId: season.id }, { name: "自建" });
    const result = await pasteStreams(db, src.id, "第1集$https://v/1.m3u8\n第3集$https://v/3.m3u8", { dryRun: true });
    expect(result.matched.length).toBe(1);
    expect(result.missing.map(m => m.episodeNumber)).toEqual([3]);
    expect(result.written).toBe(0);
    expect(await listStreams(db, src.id)).toEqual([]);
  });

  test("replaces a matched episode's stream and can create missing episodes", async () => {
    const { season } = await seasonOne();
    await generateEpisodes(db, season.id, 1, 2);
    const src = await createSource(db, { seasonId: season.id }, { name: "自建" });
    await pasteStreams(db, src.id, "第1集$https://v/old.m3u8");
    const result = await pasteStreams(db, src.id, "第1集$https://v/1.m3u8#第2集$https://v/2.m3u8#第3集$https://v/3.m3u8", { createMissing: true });
    expect(result.written).toBe(3);
    expect(result.created).toBe(1);
    expect((await listEpisodes(db, season.id)).map(e => e.episodeNumber)).toEqual([1, 2, 3]);
    const urls = (await listStreams(db, src.id)).map(s => s.url).sort();
    expect(urls).toEqual(["https://v/1.m3u8", "https://v/2.m3u8", "https://v/3.m3u8"]);
  });

  test("a movie source takes every line as a stream", async () => {
    const m = await movie();
    const src = await createSource(db, { titleId: m.id }, { name: "自建" });
    const result = await pasteStreams(db, src.id, "1080P$https://v/1080.m3u8\n4K$https://v/4k.mp4");
    expect(result.written).toBe(2);
    expect((await listStreams(db, src.id)).map(s => [s.resolution, s.format])).toEqual([
      ["1080P", "hls"],
      ["4K", "mp4"],
    ]);
  });

  test("nothing pasteable is an error", async () => {
    const m = await movie();
    const src = await createSource(db, { titleId: m.id }, { name: "自建" });
    await expect(pasteStreams(db, src.id, "hello")).rejects.toMatchObject({ code: "NOTHING_PASTED" });
  });
});

describe("the title's updatedAt", () => {
  const OLD = "2000-01-01T00:00:00.000Z";
  const age = async (id: string) => await db.update(mediaTitles).set({ updatedAt: OLD }).where(eq(mediaTitles.id, id)).run();
  const bumped = async (id: string) => (await db.select({ at: mediaTitles.updatedAt }).from(mediaTitles).where(eq(mediaTitles.id, id)).get())!.at !== OLD;

  test("moves only when an episode or movie becomes playable", async () => {
    const { title, season } = await seasonOne();
    const e1 = await createEpisode(db, season.id, { episodeNumber: 1 });
    await createEpisode(db, season.id, { episodeNumber: 2 });
    const main = await createSource(db, { seasonId: season.id }, { name: "自建" });
    const backup = await createSource(db, { seasonId: season.id }, { name: "备用" });

    await age(title.id);
    const first = await addStream(db, main.id, { url: "https://v/1.m3u8", episodeId: e1.id });
    expect(await bumped(title.id)).toBe(true);

    // Another line, a swapped url, a removed stream or line: same episodes playable.
    await age(title.id);
    const second = await addStream(db, backup.id, { url: "https://b/1.m3u8", episodeId: e1.id });
    await updateStream(db, first.id, { url: "https://v/1b.m3u8" });
    await deleteStream(db, second.id);
    await pasteStreams(db, main.id, "第1集$https://v/1c.m3u8");
    await updateSource(db, backup.id, { name: "线路二" });
    await deleteSource(db, backup.id);
    expect(await bumped(title.id)).toBe(false);

    await pasteStreams(db, main.id, "第2集$https://v/2.m3u8");
    expect(await bumped(title.id)).toBe(true);
  });

  test("enabling a line that carries new episodes counts as an update", async () => {
    const { title, season } = await seasonOne();
    const ep = await createEpisode(db, season.id, { episodeNumber: 1 });
    const off = await createSource(db, { seasonId: season.id }, { name: "自建", enabled: false });
    await age(title.id);
    await addStream(db, off.id, { url: "https://v/1.m3u8", episodeId: ep.id });
    expect(await bumped(title.id)).toBe(false);
    await updateSource(db, off.id, { enabled: true });
    expect(await bumped(title.id)).toBe(true);
  });

  test("a movie's first stream is an update, its second is not", async () => {
    const m = await movie();
    const src = await createSource(db, { titleId: m.id }, { name: "自建" });
    await age(m.id);
    await addStream(db, src.id, { url: "https://v/a.m3u8" });
    expect(await bumped(m.id)).toBe(true);
    await age(m.id);
    await addStream(db, src.id, { url: "https://v/b.m3u8", resolution: "4K" });
    expect(await bumped(m.id)).toBe(false);
  });
});

describe("people and credits", () => {
  test("credits are title-wide or per season, and listed with the person's name", async () => {
    const { title, season } = await seasonOne();
    const p = await createPerson(db, { name: "张三" });
    const q = await createPerson(db, { name: "李四" });
    await addCredit(db, title.id, {
      personId: p.id,
      role: "crew",
      job: "Director",
      department: "Directing",
    });
    const c = await addCredit(db, title.id, {
      personId: q.id,
      role: "cast",
      character: "主角",
      seasonId: season.id,
    });
    expect(c.personName).toBe("李四");
    expect((await listCredits(db, title.id)).length).toBe(2);
    expect((await listCredits(db, title.id, null)).map(x => x.personName)).toEqual(["张三"]);
    expect((await listCredits(db, title.id, season.id)).map(x => x.personName)).toEqual(["李四"]);
    expect((await personCredits(db, q.id)).map(x => x.title)).toEqual(["剧"]);
  });

  test("a credit's season must belong to its title", async () => {
    const { title } = await seasonOne();
    const other = await seasonOne();
    const p = await createPerson(db, { name: "张三" });
    await expect(addCredit(db, title.id, { personId: p.id, role: "cast", seasonId: other.season.id })).rejects.toMatchObject({ code: "SEASON_MISMATCH" });
    const c = await addCredit(db, title.id, { personId: p.id, role: "cast" });
    await expect(updateCredit(db, c.id, { seasonId: other.season.id })).rejects.toMatchObject({ code: "SEASON_MISMATCH" });
  });

  test("deleting a person removes their credits", async () => {
    const m = await movie();
    const p = await createPerson(db, { name: "张三" });
    await addCredit(db, m.id, { personId: p.id, role: "cast" });
    await deletePerson(db, p.id);
    expect(await listCredits(db, m.id)).toEqual([]);
  });
});

describe("home rows and hero", () => {
  test("a manual row keeps its titles in order; a rule row needs a rule and holds none", async () => {
    const a = await movie();
    const b = await movie();
    const row = await createRow(db, {
      name: "推荐",
      titleIds: [b.id, a.id, b.id],
    });
    expect(row.titleIds).toEqual([b.id, a.id]);
    await expect(createRow(db, { name: "x", kind: "rule" })).rejects.toMatchObject({ code: "INVALID_ROW" });
    const rule = await createRow(db, {
      name: "最新电影",
      kind: "rule",
      rule: { categoryId: "movie", sort: "updated", limit: 10 },
    });
    expect(rule.rule).toEqual({ categoryId: "movie", sort: "updated", limit: 10 });
    const switched = await updateRow(db, row.id, {
      kind: "rule",
      rule: { sort: "popular", limit: 5 },
    });
    expect(switched.titleIds).toEqual([]);
    expect((await listRows(db)).map(r => r.name)).toEqual(["推荐", "最新电影"]);
  });

  test("rows and the hero refuse unknown titles; deleting a title drops it from rows", async () => {
    const a = await movie();
    await expect(createRow(db, {
      name: "x",
      titleIds: ["nope"],
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(setHero(db, ["nope"])).rejects.toMatchObject({ statusCode: 404 });
    const row = await createRow(db, {
      name: "推荐",
      titleIds: [a.id],
    });
    expect(await setHero(db, [a.id, a.id])).toEqual([a.id]);
    expect(await getHero(db)).toEqual([a.id]);
    await deleteTitle(db, a.id);
    expect((await listRows(db)).find(r => r.id === row.id)!.titleIds).toEqual([]);
  });
});
