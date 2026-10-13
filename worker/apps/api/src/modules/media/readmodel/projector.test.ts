import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEpisode, createSeason, generateEpisodes, listEpisodes, listSeasons, updateEpisode, updateSeason } from "../catalog/seasons.service";
import { createTitle, updateTitle } from "../catalog/titles.service";
import { homeSchema, manifestSchema, playbackSchema, seasonDetailSchema, titleDetailSchema } from "../contract";
import { addCredit, createPerson } from "../people/people.service";
import { addStream, createSource, listSources, listStreams, updateStream } from "../playable/playable.service";
import { createRow, setHero } from "../taxonomy/rows.service";
import { openTestDb } from "../test-db";
import { projectLibrary } from "./projector.service";
import { createSqliteReadModel } from "./sqlite-adapter";

let db: AppDatabase;
let dispose: () => void;
let rm: ReturnType<typeof createSqliteReadModel>;

const TODAY = "2026-06-01";

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
  rm = createSqliteReadModel();
});

afterEach(() => {
  rm.close();
  dispose();
});

async function doc<T>(sql: string, ...params: unknown[]): Promise<T> {
  const row = await rm.prepare(sql).bind(...params).first<{ doc: string }>();
  return JSON.parse(row!.doc) as T;
}

/** A published series: season 1 (3 episodes, all playable) and season 2 (episode 2 airs later). */
async function series() {
  const t = await createTitle(db, { kind: "series", categoryId: "tv", title: "长安十二时辰", originCountries: ["CN"], genreIds: ["g18"], publishState: "published" });
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

describe("building the read model", () => {
  test("only published, playable things are projected", async () => {
    await createTitle(db, { kind: "movie", categoryId: "movie", title: "草稿" });
    const empty = await createTitle(db, { kind: "series", categoryId: "tv", title: "空剧", publishState: "published" });
    const m = await createTitle(db, { kind: "movie", categoryId: "movie", title: "流浪地球", releaseDate: "2019-02-05", publishState: "published" });
    const src = await createSource(db, { titleId: m.id }, { name: "自建", quality: "4K" });
    await addStream(db, src.id, { url: "https://v/m.m3u8" });
    await projectLibrary(db, rm, { today: TODAY });

    const ids = (await rm.prepare("SELECT id FROM rm_titles").all<{ id: number }>()).results.map(r => r.id);
    expect(ids).toEqual([m.id]);
    expect(ids).not.toContain(empty.id);
    const detail = titleDetailSchema.parse(await doc("SELECT detail_json AS doc FROM rm_titles WHERE id = ?", m.id));
    expect(detail).toMatchObject({ id: `t${m.id}`, badge: "4K", available: true, year: 2019 });
    const play = playbackSchema.parse(await doc("SELECT json AS doc FROM rm_playback WHERE id = ?", `t${m.id}`));
    expect(play.sources[0]!.streams[0]!.url).toBe("https://v/m.m3u8");
    expect((await rm.prepare("SELECT vod_id FROM rm_cms_items").all<{ vod_id: string }>()).results).toEqual([{ vod_id: `m${m.id}` }]);
  });

  test("seasons gate episodes by air date and playback continues into the next season", async () => {
    const { title, s1, s2 } = await series();
    await projectLibrary(db, rm, { today: TODAY });

    const detail = titleDetailSchema.parse(await doc("SELECT detail_json AS doc FROM rm_titles WHERE id = ?", title.id));
    expect(detail.defaultSeason).toBe(`s${s2.id}`);
    expect(detail.badge).toBe("第 2 季 更新至第 1 集");
    expect(detail.seasons.map(s => [s.number, s.availableCount, s.nextAirDate])).toEqual([[1, 3, null], [2, 1, "2026-07-01"]]);

    const season2 = seasonDetailSchema.parse(await doc("SELECT detail_json AS doc FROM rm_seasons WHERE id = ?", s2.id));
    expect(season2.episodes.map(e => e.available)).toEqual([true, false]);

    const s1Episodes = await listEpisodes(db, s1.id);
    const last = playbackSchema.parse(await doc("SELECT json AS doc FROM rm_playback WHERE id = ?", `e${s1Episodes[2]!.id}`));
    expect(last.next).toMatchObject({ seasonId: `s${s2.id}`, number: 1 });
    const unaired = (await listEpisodes(db, s2.id))[1]!;
    expect(await rm.prepare("SELECT id FROM rm_playback WHERE id = ?").bind(`e${unaired.id}`).first()).toBeNull();
    expect((await rm.prepare("SELECT vod_id FROM rm_cms_items ORDER BY group_order").all<{ vod_id: string }>()).results.map(r => r.vod_id)).toEqual([`s${s1.id}`, `s${s2.id}`]);
  });

  test("home, manifest and facets are stored as meta", async () => {
    const { title } = await series();
    await createRow(db, { name: "最新", kind: "rule", rule: { sort: "updated", limit: 20 } });
    await setHero(db, [title.id]);
    const person = await createPerson(db, { name: "雷佳音" });
    await addCredit(db, title.id, { personId: person.id, role: "cast", character: "张小敬" });
    const { generation } = await projectLibrary(db, rm, { today: TODAY });

    const meta = async (key: string) => JSON.parse((await rm.prepare("SELECT value FROM rm_meta WHERE key = ?").bind(key).first<{ value: string }>())!.value);
    expect((await rm.prepare("SELECT value FROM rm_meta WHERE key = 'generation'").first<{ value: string }>())!.value).toBe(generation);
    const home = homeSchema.parse(await meta("home"));
    expect(home.hero.map(h => h.id)).toEqual([`t${title.id}`]);
    expect(home.rows[0]!.items.map(i => i.id)).toEqual([`t${title.id}`]);
    const manifest = manifestSchema.parse({ ...await meta("manifest"), generation });
    expect(manifest.categories.find(c => c.id === "tv")!.count).toBe(1);
    expect(manifest.countries).toEqual([{ code: "CN", name: "中国大陆" }]);
    expect((await meta("facets:tv")).genre[0]).toMatchObject({ value: "g18", count: 1 });
    expect(await rm.prepare("SELECT json FROM rm_people WHERE id = ?").bind(person.id).first()).not.toBeNull();
  });
});

describe("writing the read model", () => {
  test("a publish without changes writes only the generation", async () => {
    await series();
    await projectLibrary(db, rm, { today: TODAY });
    const before = rm.statements;
    const result = await projectLibrary(db, rm, { today: TODAY });
    expect(result).toMatchObject({ upserted: 0, deleted: 0 });
    expect(rm.statements - before).toBe(1);
  });

  test("a changed episode rewrites its season, its playback and the title it bumps", async () => {
    const { title, s1, s2 } = await series();
    await projectLibrary(db, rm, { today: TODAY });
    const hashes = async () => {
      const out = new Map<string, string>();
      for (const [table, key] of [["rm_titles", "id"], ["rm_seasons", "id"], ["rm_playback", "id"], ["rm_people", "id"], ["rm_search", "ref"], ["rm_cms_items", "vod_id"]] as const) {
        for (const r of (await rm.prepare(`SELECT ${key} AS id, hash FROM ${table}`).all<{ id: string; hash: string }>()).results)
          out.set(`${table}:${r.id}`, r.hash);
      }
      return out;
    };
    const before = await hashes();
    const [, second] = await listEpisodes(db, s1.id);
    await updateEpisode(db, second!.id, { name: "大案" });
    const result = await projectLibrary(db, rm, { today: TODAY });
    const after = await hashes();
    const changed = [...after].filter(([k, h]) => before.get(k) !== h).map(([k]) => k).sort();
    // The edit bumps the title's `updatedAt`, which its card and CMS items carry.
    expect(changed).toEqual([
      `rm_cms_items:s${s1.id}`,
      `rm_cms_items:s${s2.id}`,
      `rm_playback:e${second!.id}`,
      `rm_seasons:${s1.id}`,
      `rm_titles:${title.id}`,
    ].sort());
    expect(result).toMatchObject({ upserted: 5, deleted: 0 });
  });

  test("a swapped stream url rewrites only its playback and CMS item", async () => {
    const { s1 } = await series();
    await projectLibrary(db, rm, { today: TODAY });
    const before = await rm.prepare("SELECT vod_id, hash FROM rm_cms_items").all<{ vod_id: string; hash: string }>();
    const [first] = await listEpisodes(db, s1.id);
    const [source] = await listSources(db, { seasonId: s1.id });
    const stream = (await listStreams(db, source!.id)).find(x => x.episodeId === first!.id)!;
    await updateStream(db, stream.id, { url: "https://v/new.m3u8" });
    const result = await projectLibrary(db, rm, { today: TODAY });
    expect(result).toMatchObject({ upserted: 2, deleted: 0 });
    const after = await rm.prepare("SELECT vod_id, hash FROM rm_cms_items").all<{ vod_id: string; hash: string }>();
    const changed = after.results.filter(r => before.results.find(b => b.vod_id === r.vod_id)?.hash !== r.hash).map(r => r.vod_id);
    expect(changed).toEqual([`s${s1.id}`]);
  });

  test("unpublishing removes a title and everything hanging off it", async () => {
    const { title } = await series();
    await projectLibrary(db, rm, { today: TODAY });
    await updateTitle(db, title.id, { publishState: "draft" });
    await projectLibrary(db, rm, { today: TODAY });
    for (const table of ["rm_titles", "rm_title_genres", "rm_seasons", "rm_playback", "rm_cms_items", "rm_search"]) {
      const row = await rm.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect([table, row!.n]).toEqual([table, 0]);
    }
  });

  test("a full rebuild starts from an empty read model", async () => {
    await series();
    await projectLibrary(db, rm, { today: TODAY });
    await rm.prepare("INSERT INTO rm_people (id, json, hash) VALUES (999, '{}', 'x')").run();
    const result = await projectLibrary(db, rm, { today: TODAY, full: true });
    expect(result.deleted).toBe(0);
    expect(await rm.prepare("SELECT id FROM rm_people WHERE id = 999").first()).toBeNull();
  });
});
