import type { MediaDb } from "./db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createEpisode, listSeasons, updateSeason } from "./catalog/seasons.service";
import { createTitle, updateTitle } from "./catalog/titles.service";
import { markPublished, publishedGeneration } from "./publish";
import { openTestDb } from "./test-db";

let db: MediaDb;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

async function marked(kind: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM media_published WHERE kind = ${kind} ORDER BY id`);
  return rows.map(r => r.id);
}

describe("publishing marks what is live", () => {
  test("titles, seasons and episodes are marked by id; a later publish follows edits", async () => {
    const live = await createTitle(db, { kind: "series", categoryId: "tv", title: "上线", publishState: "published" });
    const draft = await createTitle(db, { kind: "movie", categoryId: "movie", title: "草稿" });
    const season = (await listSeasons(db, live.id))[0]!;
    await updateSeason(db, season.id, { publishState: "published" });
    const episode = await createEpisode(db, season.id, { episodeNumber: 1 });
    expect(await publishedGeneration(db)).toBeNull();

    const first = await markPublished(db);
    expect(await marked("title")).toEqual([live.id]);
    expect(await marked("season")).toEqual([season.id]);
    expect(await marked("episode")).toEqual([episode.id]);
    expect(await publishedGeneration(db)).toBe(first.generation);

    // Nothing changes on devices until the next publish.
    await updateTitle(db, draft.id, { publishState: "published" });
    await updateTitle(db, live.id, { publishState: "draft" });
    expect(await marked("title")).toEqual([live.id]);

    const second = await markPublished(db);
    expect(await marked("title")).toEqual([draft.id]);
    expect(second.generation).not.toBe(first.generation);
    expect(second.titles).toBe(1);
  });

  test("a library the size of production publishes without loading it", async () => {
    // 5000 titles, 40k people, 75k credits, written straight in SQL.
    await db.run(sql`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
      INSERT INTO media_titles (id, kind, category_id, title, publish_state, created_at, updated_at) SELECT 't' || i, 'movie', 'movie', 'Title ' || i, 'published', '2026-01-01', '2026-01-01' FROM n`);
    await db.run(sql`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40000)
      INSERT INTO media_people (id, name, created_at, updated_at) SELECT 'p' || i, 'Person ' || i, '2026-01-01', '2026-01-01' FROM n`);
    await db.run(sql`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 75000)
      INSERT INTO media_credits (id, person_id, title_id, role) SELECT 'c' || i, 'p' || (1 + i % 40000), 't' || (1 + i % 5000), 'cast' FROM n`);

    const result = await markPublished(db);
    expect(result.titles).toBe(5000);
    const [count] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media_published WHERE kind = 'title'`);
    expect(count!.n).toBe(5000);
  });
});
