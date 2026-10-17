import type { MediaDb, Statement } from "../db";
import { and, asc, eq } from "drizzle-orm";
import { NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { insertRows } from "../db";
import { mediaTitles, mediaTitleTranslations } from "../schema";

export type TranslationRow = typeof mediaTitleTranslations.$inferSelect;

export interface TranslationInput {
  readonly title?: string | null | undefined;
  readonly overview?: string | null | undefined;
  readonly tagline?: string | null | undefined;
}

export type TranslationItem = TranslationInput & { readonly locale: string };

async function assertTitle(db: MediaDb, titleId: string): Promise<void> {
  const row = await db.select({ id: mediaTitles.id }).from(mediaTitles).where(eq(mediaTitles.id, titleId)).get();
  if (!row)
    throw new NotFoundError("Title", titleId);
}

export async function listTranslations(db: MediaDb, titleId: string): Promise<TranslationRow[]> {
  return await db.select().from(mediaTitleTranslations).where(eq(mediaTitleTranslations.titleId, titleId)).orderBy(asc(mediaTitleTranslations.locale)).all();
}

/** Create or replace the translation of one locale. */
export async function putTranslation(db: MediaDb, titleId: string, locale: string, input: TranslationInput): Promise<TranslationRow> {
  await assertTitle(db, titleId);
  const values = { title: input.title ?? null, overview: input.overview ?? null, tagline: input.tagline ?? null };
  await db.insert(mediaTitleTranslations)
    .values({ id: ulid(), titleId, locale, ...values })
    .onConflictDoUpdate({ target: [mediaTitleTranslations.titleId, mediaTitleTranslations.locale], set: values })
    .run();
  return (await db.select().from(mediaTitleTranslations).where(and(eq(mediaTitleTranslations.titleId, titleId), eq(mediaTitleTranslations.locale, locale))).get())!;
}

export async function deleteTranslation(db: MediaDb, titleId: string, locale: string): Promise<TranslationRow> {
  const row = await db.select().from(mediaTitleTranslations).where(and(eq(mediaTitleTranslations.titleId, titleId), eq(mediaTitleTranslations.locale, locale))).get();
  if (!row)
    throw new NotFoundError("Translation", locale);
  await db.delete(mediaTitleTranslations).where(eq(mediaTitleTranslations.id, row.id)).run();
  return row;
}

/** Statements replacing every translation of a title with `items` (the importer's whole-set write). */
export function replaceTranslations(db: MediaDb, titleId: string, items: readonly TranslationItem[]): Statement[] {
  const rows = items.map(item => ({ id: ulid(), titleId, locale: item.locale, title: item.title ?? null, overview: item.overview ?? null, tagline: item.tagline ?? null }));
  return [db.delete(mediaTitleTranslations).where(eq(mediaTitleTranslations.titleId, titleId)), ...insertRows(db, mediaTitleTranslations, rows)];
}
