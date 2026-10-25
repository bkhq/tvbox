import type { MediaDb, Statement } from "../db";
import type { OwnerType } from "../shared/owners";
import { and, asc, eq, max, ne } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { runBatch } from "../db";
import { mediaImages } from "../schema";
import { assertOwner } from "../shared/owners";

export type ImageRow = typeof mediaImages.$inferSelect;
export type ImageKind = ImageRow["kind"];

export interface ImageInput {
  readonly kind: ImageKind;
  readonly url?: string | null | undefined;
  readonly assetSha256?: string | null | undefined;
  readonly assetName?: string | null | undefined;
  readonly locale?: string | null | undefined;
  readonly width?: number | null | undefined;
  readonly height?: number | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export async function getImage(db: MediaDb, id: string): Promise<ImageRow> {
  const row = await db.select().from(mediaImages).where(eq(mediaImages.id, id)).get();
  if (!row)
    throw new NotFoundError("Image", id);
  return row;
}

export async function listImages(db: MediaDb, ownerType: OwnerType, ownerId: string): Promise<ImageRow[]> {
  return await db.select().from(mediaImages).where(and(eq(mediaImages.ownerType, ownerType), eq(mediaImages.ownerId, ownerId))).orderBy(asc(mediaImages.kind), asc(mediaImages.sort), asc(mediaImages.id)).all();
}

function assertSource(url: string | null | undefined, sha: string | null | undefined): void {
  if (!url === !sha)
    throw new AppError("An image needs either a url or an uploaded asset, not both", 422, "INVALID_IMAGE");
}

/** At most one primary image per owner and kind. */
function clearPrimary(db: MediaDb, row: Pick<ImageRow, "id" | "ownerType" | "ownerId" | "kind">): Statement {
  return db.update(mediaImages).set({ isPrimary: false }).where(and(
    eq(mediaImages.ownerType, row.ownerType),
    eq(mediaImages.ownerId, row.ownerId),
    eq(mediaImages.kind, row.kind),
    ne(mediaImages.id, row.id),
  ));
}

/** The first image of a kind becomes primary. */
export async function addImage(db: MediaDb, ownerType: OwnerType, ownerId: string, input: ImageInput): Promise<ImageRow> {
  await assertOwner(db, ownerType, ownerId);
  assertSource(input.url, input.assetSha256);
  const id = ulid();
  const same = and(eq(mediaImages.ownerType, ownerType), eq(mediaImages.ownerId, ownerId), eq(mediaImages.kind, input.kind));
  const last = await db.select({
    sort: max(mediaImages.sort),
  }).from(mediaImages).where(same).get();
  const isPrimary = input.isPrimary ?? last?.sort == null;
  await runBatch(db, [
    db.insert(mediaImages).values({
      id,
      ownerType,
      ownerId,
      kind: input.kind,
      url: input.url ?? null,
      assetSha256: input.assetSha256 ?? null,
      assetName: input.assetName ?? null,
      locale: input.locale ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      isPrimary,
      sort: (last?.sort ?? -1) + 1,
    }),
    ...(isPrimary
      ? [
          clearPrimary(db, {
            id,
            ownerType,
            ownerId,
            kind: input.kind,
          }),
        ]
      : []),
  ]);
  return await getImage(db, id);
}

export async function updateImage(db: MediaDb, id: string, patch: Partial<Omit<ImageInput, "kind">> & { sort?: number | undefined }): Promise<ImageRow> {
  const current = await getImage(db, id);
  const url = patch.url !== undefined
    ? patch.url
    : current.url;
  const sha = patch.assetSha256 !== undefined
    ? patch.assetSha256
    : current.assetSha256;
  assertSource(url, sha);
  await runBatch(db, [
    db.update(mediaImages).set(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))).where(eq(mediaImages.id, id)),
    ...(patch.isPrimary
      ? [
          clearPrimary(db, current),
        ]
      : []),
  ]);
  return await getImage(db, id);
}

export async function deleteImage(db: MediaDb, id: string): Promise<ImageRow> {
  const current = await getImage(db, id);
  await db.delete(mediaImages).where(eq(mediaImages.id, id)).run();
  return current;
}
