import type { MediaDb } from "../db";
import type { EXTERNAL_OWNER_TYPES } from "../schema";
import { and, asc, eq } from "drizzle-orm";
import { AppError, isUniqueViolation, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { mediaExternalIds } from "../schema";
import { assertOwner } from "./owners";

export type ExternalIdRow = typeof mediaExternalIds.$inferSelect;
export type ExternalOwnerType = typeof EXTERNAL_OWNER_TYPES[number];

export async function listExternalIds(db: MediaDb, ownerType: ExternalOwnerType, ownerId: string): Promise<ExternalIdRow[]> {
  return await db.select().from(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, ownerType), eq(mediaExternalIds.ownerId, ownerId))).orderBy(asc(mediaExternalIds.source)).all();
}

/** One external id points at one owner: a second owner claiming it is a conflict. */
export async function addExternalId(
  db: MediaDb,
  ownerType: ExternalOwnerType,
  ownerId: string,
  input: { source: ExternalIdRow["source"]; externalId: string },
): Promise<ExternalIdRow> {
  await assertOwner(db, ownerType, ownerId);
  const id = ulid();
  try {
    await db.insert(mediaExternalIds).values({
      id,
      ownerType,
      ownerId,
      source: input.source,
      externalId: input.externalId,
    }).run();
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new AppError(`${input.source} id ${input.externalId} is already linked`, 409, "EXTERNAL_ID_TAKEN");
    throw err;
  }
  return (await db.select().from(mediaExternalIds).where(eq(mediaExternalIds.id, id)).get())!;
}

export async function deleteExternalId(db: MediaDb, id: string): Promise<ExternalIdRow> {
  const row = await db.select().from(mediaExternalIds).where(eq(mediaExternalIds.id, id)).get();
  if (!row)
    throw new NotFoundError("External id", id);
  await db.delete(mediaExternalIds).where(eq(mediaExternalIds.id, id)).run();
  return row;
}

/** Which owner an external id belongs to, if any: the lookup scrapers and collectors dedupe by. */
export async function findByExternalId(
  db: MediaDb,
  ownerType: ExternalOwnerType,
  source: ExternalIdRow["source"],
  externalId: string,
): Promise<string | null> {
  const row = await db.select({ ownerId: mediaExternalIds.ownerId }).from(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, ownerType), eq(mediaExternalIds.source, source), eq(mediaExternalIds.externalId, externalId))).get();
  return row?.ownerId ?? null;
}
