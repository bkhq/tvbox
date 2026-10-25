import type { MediaDb } from "../db";
import { asc, count, eq } from "drizzle-orm";
import { NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { runBatch } from "../db";
import { mediaCollections, mediaTitles } from "../schema";
import { deleteOwned } from "../shared/owners";

type CollectionRow = typeof mediaCollections.$inferSelect;
export interface CollectionView extends CollectionRow {
  readonly titleCount: number;
}

export async function getCollection(db: MediaDb, id: string): Promise<CollectionView> {
  const row = await db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).get();
  if (!row)
    throw new NotFoundError("Collection", id);
  const n = await db.select({
    n: count(),
  }).from(mediaTitles).where(eq(mediaTitles.collectionId, id)).get();
  return { ...row, titleCount: n?.n ?? 0 };
}

export async function listCollections(db: MediaDb): Promise<CollectionView[]> {
  const rows = await db.select().from(mediaCollections).orderBy(asc(mediaCollections.name)).all();
  const counts = await db.select({
    id: mediaTitles.collectionId,
    n: count(),
  }).from(mediaTitles).groupBy(mediaTitles.collectionId).all();
  return rows.map(r => ({ ...r, titleCount: counts.find(c => c.id === r.id)?.n ?? 0 }));
}

export async function createCollection(db: MediaDb, input: { name: string; overview?: string | null | undefined }): Promise<CollectionView> {
  const id = ulid();
  await db.insert(mediaCollections).values({ id, name: input.name, overview: input.overview ?? null }).run();
  return await getCollection(db, id);
}

export async function updateCollection(db: MediaDb, id: string, patch: { name?: string | undefined; overview?: string | null | undefined }): Promise<CollectionView> {
  await getCollection(db, id);
  await db.update(mediaCollections).set({
    ...(patch.name !== undefined
      ? { name: patch.name }
      : {}),
    ...(patch.overview !== undefined
      ? { overview: patch.overview }
      : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(mediaCollections.id, id)).run();
  return await getCollection(db, id);
}

/** Its titles stay, outside any collection. */
export async function deleteCollection(db: MediaDb, id: string): Promise<CollectionView> {
  const current = await getCollection(db, id);
  await runBatch(db, [
    ...deleteOwned(db, "collection", [id]),
    db.delete(mediaCollections).where(eq(mediaCollections.id, id)),
  ]);
  return current;
}
