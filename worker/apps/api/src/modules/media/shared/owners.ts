import type { IMAGE_OWNER_TYPES } from "../schema";
import type { TxOrDb } from "./db";
import type { AppDatabase } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { NotFoundError } from "@/shared/lib/errors";
import { mediaCollections, mediaEpisodes, mediaExternalIds, mediaImages, mediaPeople, mediaSeasons, mediaTitles } from "../schema";

export type OwnerType = typeof IMAGE_OWNER_TYPES[number];

/** Throws NotFoundError unless the owner of an image or external id exists. */
export async function assertOwner(db: AppDatabase, type: OwnerType, id: string): Promise<void> {
  const numeric = Number(id);
  const found = type === "title"
    ? await db.select({ id: mediaTitles.id }).from(mediaTitles).where(eq(mediaTitles.id, numeric)).get()
    : type === "season"
      ? await db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(eq(mediaSeasons.id, numeric)).get()
      : type === "person"
        ? await db.select({ id: mediaPeople.id }).from(mediaPeople).where(eq(mediaPeople.id, numeric)).get()
        : type === "episode"
          ? await db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(eq(mediaEpisodes.id, id)).get()
          : await db.select({ id: mediaCollections.id }).from(mediaCollections).where(eq(mediaCollections.id, id)).get();
  if (!found)
    throw new NotFoundError(type, id);
}

/**
 * Images and external ids carry no foreign key (they hang off several owner
 * types), so whoever deletes an owner removes them through here.
 */
export async function deleteOwned(db: TxOrDb, type: OwnerType, ids: readonly (string | number)[]): Promise<void> {
  const keys = ids.map(String);
  for (const part of chunked(keys)) {
    await db.delete(mediaImages).where(and(eq(mediaImages.ownerType, type), inArray(mediaImages.ownerId, part))).run();
    if (type !== "collection")
      await db.delete(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, type), inArray(mediaExternalIds.ownerId, part))).run();
  }
}

/** Everything owned by a season and its episodes. */
export async function deleteSeasonOwned(db: TxOrDb, seasonIds: readonly number[]): Promise<void> {
  for (const part of chunked(seasonIds)) {
    const episodes = await db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(inArray(mediaEpisodes.seasonId, part)).all();
    await deleteOwned(db, "episode", episodes.map(e => e.id));
  }
  await deleteOwned(db, "season", seasonIds);
}
