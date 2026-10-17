import type { MediaDb, Statement } from "../db";
import type { IMAGE_OWNER_TYPES } from "../schema";
import { and, eq, inArray } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { NotFoundError } from "@/shared/lib/errors";
import { mediaCollections, mediaEpisodes, mediaExternalIds, mediaImages, mediaPeople, mediaSeasons, mediaTitles } from "../schema";

export type OwnerType = typeof IMAGE_OWNER_TYPES[number];

/** Throws NotFoundError unless the owner of an image or external id exists. */
export async function assertOwner(db: MediaDb, type: OwnerType, id: string): Promise<void> {
  const found = type === "title"
    ? await db.select({ id: mediaTitles.id }).from(mediaTitles).where(eq(mediaTitles.id, id)).get()
    : type === "season"
      ? await db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(eq(mediaSeasons.id, id)).get()
      : type === "person"
        ? await db.select({ id: mediaPeople.id }).from(mediaPeople).where(eq(mediaPeople.id, id)).get()
        : type === "episode"
          ? await db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(eq(mediaEpisodes.id, id)).get()
          : await db.select({ id: mediaCollections.id }).from(mediaCollections).where(eq(mediaCollections.id, id)).get();
  if (!found)
    throw new NotFoundError(type, id);
}

/**
 * Images and external ids carry no foreign key (they hang off several owner
 * types), so whoever deletes an owner removes them with these statements.
 */
export function deleteOwned(db: MediaDb, type: OwnerType, ids: readonly string[]): Statement[] {
  const out: Statement[] = [];
  for (const part of chunked(ids)) {
    out.push(db.delete(mediaImages).where(and(eq(mediaImages.ownerType, type), inArray(mediaImages.ownerId, part))));
    if (type !== "collection")
      out.push(db.delete(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, type), inArray(mediaExternalIds.ownerId, part))));
  }
  return out;
}

/** Everything owned by seasons and their episodes. */
export async function deleteSeasonOwned(db: MediaDb, seasonIds: readonly string[]): Promise<Statement[]> {
  const out: Statement[] = [];
  for (const part of chunked(seasonIds)) {
    const episodes = await db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(inArray(mediaEpisodes.seasonId, part)).all();
    out.push(...deleteOwned(db, "episode", episodes.map(e => e.id)));
  }
  out.push(...deleteOwned(db, "season", seasonIds));
  return out;
}
