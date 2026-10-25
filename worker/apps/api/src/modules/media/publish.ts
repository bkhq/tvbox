import type { MediaDb, Statement } from "./db";
import { eq, sql } from "drizzle-orm";
import { ulid } from "@/shared/lib/id";
import { runBatch } from "./db";
import { mediaSettings } from "./schema";

export const GENERATION_KEY = "published_generation";

const KINDS = [
  { kind: "title", table: sql`media_titles` },
  { kind: "season", table: sql`media_seasons` },
  { kind: "episode", table: sql`media_episodes` },
] as const;

/**
 * Publish the library: mark what is published now as live, in SQL so the
 * library is never loaded. Only changed ids are written; the generation,
 * which clients cache by, goes last.
 */
export async function markPublished(db: MediaDb): Promise<{ generation: string; titles: number }> {
  const generation = ulid();
  const statements: Statement[] = [];
  for (const { kind: name, table } of KINDS) {
    // A literal: D1 batches cannot carry raw SQL with parameters.
    const kind = sql.raw(`'${name}'`);
    statements.push(
      db.run(sql`DELETE FROM media_published WHERE kind = ${kind} AND id NOT IN (SELECT id FROM ${table} WHERE publish_state = 'published')`),
      db.run(sql`INSERT OR IGNORE INTO media_published (id, kind) SELECT id, ${kind} FROM ${table} WHERE publish_state = 'published'`),
    );
  }
  const value = JSON.stringify(generation);
  statements.push(db.insert(mediaSettings).values({ key: GENERATION_KEY, value })
    .onConflictDoUpdate({ target: mediaSettings.key, set: { value, updatedAt: new Date().toISOString() } }));
  await runBatch(db, statements);
  const [count] = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM media_published WHERE kind = 'title'`);
  return { generation, titles: count?.n ?? 0 };
}

/** The last publish's generation; null before the first. */
export async function publishedGeneration(db: MediaDb): Promise<string | null> {
  const row = await db.select({ value: mediaSettings.value }).from(mediaSettings).where(eq(mediaSettings.key, GENERATION_KEY)).get();
  return row ? JSON.parse(row.value) as string : null;
}
