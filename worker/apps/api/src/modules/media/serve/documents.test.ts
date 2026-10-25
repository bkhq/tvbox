import type { MediaDb } from "../db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEpisode, createSeason, generateEpisodes, listEpisodes, listSeasons, updateSeason } from "../catalog/seasons.service";
import { createTitle } from "../catalog/titles.service";
import { putTranslation } from "../catalog/translations.service";
import { playbackSchema, seasonDetailSchema, titleDetailSchema } from "../contract";
import { addStream, createSource } from "../playable/playable.service";
import { markPublished } from "../publish";
import { openTestDb } from "../test-db";
import { buildCmsItems } from "./cms";
import { buildTitles } from "./documents";
import { loadSlice } from "./slice";

let db: MediaDb;
let dispose: () => void;

const TODAY = "2026-06-01";

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

async function build(ids: string[]) {
  const slice = await loadSlice(db, ids);
  const built = buildTitles(slice, TODAY);
  const cms = buildCmsItems(built.titles, built.seasons, built.playback, new Map(), new Map());
  return { ...built, cms };
}

/** A published series: season 1 (3 episodes, all playable) and season 2 (episode 2 airs later). */
async function series() {
  const t = await createTitle(db, {
    kind: "series",
    categoryId: "tv",
    title: "长安十二时辰",
    originCountries: ["CN"],
    genreIds: ["g18"],
    publishState: "published",
  });
  const s1 = (await listSeasons(db, t.id))[0]!;
  await updateSeason(db, s1.id, { publishState: "published", status: "ended", airDate: "2019-06-27" });
  const s2 = await createSeason(db, t.id, { seasonNumber: 2, publishState: "published", airDate: "2026-05-01" });
  await generateEpisodes(db, s1.id, 1, 3);
  await createEpisode(db, s2.id, { episodeNumber: 1, airDate: "2026-05-01" });
  await createEpisode(db, s2.id, { episodeNumber: 2, airDate: "2026-07-01" });
  for (const season of [s1, s2]) {
    const src = await createSource(db, { seasonId: season.id }, { name: "自建", quality: "1080p" });
    for (const e of await listEpisodes(db, season.id))
      await addStream(db, src.id, { url: `https://v/${season.seasonNumber}/${e.episodeNumber}.m3u8`, episodeId: e.id });
  }
  return { title: t, s1, s2 };
}

describe("building documents from a slice", () => {
  test("only marked, playable titles are built", async () => {
    const draft = await createTitle(db, { kind: "movie", categoryId: "movie", title: "草稿" });
    const empty = await createTitle(db, {
      kind: "series",
      categoryId: "tv",
      title: "空剧",
      publishState: "published",
    });
    const m = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "流浪地球",
      releaseDate: "2019-02-05",
      publishState: "published",
    });
    const src = await createSource(db, { titleId: m.id }, { name: "自建", quality: "4K" });
    await addStream(db, src.id, { url: "https://v/m.m3u8" });
    expect((await build([m.id])).titles).toEqual([]);
    await markPublished(db);

    const built = await build([draft.id, empty.id, m.id]);
    expect(built.titles.map(t => t.id)).toEqual([m.id]);
    expect(titleDetailSchema.parse(built.titles[0]!.detail)).toMatchObject({
      id: m.id,
      badge: "4K",
      available: true,
      year: 2019,
    });
    const play = playbackSchema.parse(built.playback.find(p => p.id === m.id)!.doc);
    expect(play.sources[0]!.streams[0]!.url).toBe("https://v/m.m3u8");
    expect(built.cms.map(i => i.vodId)).toEqual([m.id]);
  });

  test("seasons gate episodes by air date and playback continues into the next season", async () => {
    const { title, s1, s2 } = await series();
    await markPublished(db);

    const built = await build([title.id]);
    const detail = titleDetailSchema.parse(built.titles[0]!.detail);
    expect(detail.defaultSeason).toBe(s2.id);
    expect(detail.badge).toBe("第 2 季 更新至第 1 集");
    expect(detail.seasons.map(s => [s.number, s.availableCount, s.nextAirDate])).toEqual([
      [1, 3, null],
      [2, 1, "2026-07-01"],
    ]);

    const season2 = seasonDetailSchema.parse(built.seasons.find(s => s.id === s2.id)!.detail);
    expect(season2.episodes.map(e => e.available)).toEqual([true, false]);

    const s1Episodes = await listEpisodes(db, s1.id);
    const last = playbackSchema.parse(built.playback.find(p => p.id === s1Episodes[2]!.id)!.doc);
    expect(last.next).toMatchObject({ seasonId: s2.id, number: 1 });
    const unaired = (await listEpisodes(db, s2.id))[1]!;
    expect(built.playback.find(p => p.id === unaired.id)).toBeUndefined();
    expect(built.cms.map(i => i.vodId)).toEqual([s1.id, s2.id]);
  });

  test("a season published after the last publish stays hidden until the next", async () => {
    const { title } = await series();
    await markPublished(db);
    const s3 = await createSeason(db, title.id, { seasonNumber: 3, publishState: "published" });
    const e = await createEpisode(db, s3.id, { episodeNumber: 1 });
    const src = await createSource(db, { seasonId: s3.id }, { name: "自建" });
    await addStream(db, src.id, { url: "https://v/3/1.m3u8", episodeId: e.id });
    expect((await build([title.id])).seasons.map(s => s.number)).toEqual([1, 2]);
    await markPublished(db);
    expect((await build([title.id])).seasons.map(s => s.number)).toEqual([1, 2, 3]);
  });

  test("translations go into the detail document", async () => {
    const m = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "盗梦空间",
      publishState: "published",
    });
    await putTranslation(db, m.id, "en-US", { title: "Inception", overview: "A thief who steals secrets", tagline: null });
    await putTranslation(db, m.id, "zh-TW", { title: "全面啟動" });
    await markPublished(db);

    const detail = titleDetailSchema.parse((await build([m.id])).titles[0]!.detail);
    expect(detail.translations).toEqual({
      "en-US": { title: "Inception", overview: "A thief who steals secrets", tagline: null },
      "zh-TW": { title: "全面啟動", overview: null, tagline: null },
    });
  });
});
