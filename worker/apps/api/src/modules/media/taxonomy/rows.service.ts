import type { MediaDb } from "../db";
import { asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { chunked } from "@/shared/lib/chunk";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { insertRows, runBatch } from "../db";
import { mediaRowItems, mediaRows, mediaSettings, mediaTitles } from "../schema";

export type RowRow = typeof mediaRows.$inferSelect;

export const ROW_SORTS = ["updated", "popular", "release", "rating"] as const;

/** What a rule row selects; expanded into titles when publishing. */
export const rowRuleSchema = z.object({
  categoryId: z.string().max(32).optional(),
  genreId: z.string().max(64).optional(),
  kind: z.enum(["movie", "series"]).optional(),
  sort: z.enum(ROW_SORTS).default("updated"),
  limit: z.number().int().min(1).max(50).default(20),
});
export type RowRule = z.infer<typeof rowRuleSchema>;

export interface RowView extends Omit<RowRow, "rule"> {
  readonly rule: RowRule | null;
  readonly titleIds: string[];
}

export const HERO_KEY = "hero_title_ids";
const MAX_ROW_ITEMS = 100;

async function viewOf(db: MediaDb, row: RowRow): Promise<RowView> {
  const items = await db.select({ titleId: mediaRowItems.titleId }).from(mediaRowItems).where(eq(mediaRowItems.rowId, row.id)).orderBy(asc(mediaRowItems.sort)).all();
  return { ...row, rule: row.rule ? rowRuleSchema.parse(JSON.parse(row.rule)) : null, titleIds: items.map(i => i.titleId) };
}

export async function getRow(db: MediaDb, id: string): Promise<RowView> {
  const row = await db.select().from(mediaRows).where(eq(mediaRows.id, id)).get();
  if (!row)
    throw new NotFoundError("Row", id);
  return await viewOf(db, row);
}

export async function listRows(db: MediaDb): Promise<RowView[]> {
  const rows = await db.select().from(mediaRows).orderBy(asc(mediaRows.sort), asc(mediaRows.id)).all();
  const out: RowView[] = [];
  for (const row of rows)
    out.push(await viewOf(db, row));
  return out;
}

async function assertTitles(db: MediaDb, ids: readonly string[]): Promise<void> {
  if (ids.length > MAX_ROW_ITEMS)
    throw new AppError(`A row holds at most ${MAX_ROW_ITEMS} titles`, 422, "ROW_TOO_LONG");
  for (const part of chunked([...new Set(ids)])) {
    const found = await db.select({ id: mediaTitles.id }).from(mediaTitles).where(inArray(mediaTitles.id, part)).all();
    const missing = part.find(id => !found.some(f => f.id === id));
    if (missing !== undefined)
      throw new NotFoundError("Title", String(missing));
  }
}

async function writeItems(db: MediaDb, rowId: string, titleIds: readonly string[]): Promise<void> {
  const unique = [...new Set(titleIds)];
  await runBatch(db, [
    db.delete(mediaRowItems).where(eq(mediaRowItems.rowId, rowId)),
    ...insertRows(db, mediaRowItems, unique.map((titleId, sort) => ({ rowId, titleId, sort }))),
  ]);
}

export interface RowInput {
  readonly name?: string | undefined;
  readonly kind?: RowRow["kind"] | undefined;
  readonly rule?: RowRule | null | undefined;
  readonly onHome?: boolean | undefined;
  readonly titleIds?: readonly string[] | undefined;
}

function assertShape(kind: RowRow["kind"], rule: RowRule | null | undefined): void {
  if (kind === "rule" && !rule)
    throw new AppError("A rule row needs a rule", 422, "INVALID_ROW");
}

export async function createRow(db: MediaDb, input: RowInput & { name: string }): Promise<RowView> {
  const kind = input.kind ?? "manual";
  assertShape(kind, input.rule);
  if (input.titleIds)
    await assertTitles(db, input.titleIds);
  const last = await db.select({ sort: max(mediaRows.sort) }).from(mediaRows).get();
  const id = ulid();
  await db.insert(mediaRows).values({
    id,
    name: input.name,
    kind,
    rule: kind === "rule" ? JSON.stringify(input.rule) : null,
    onHome: input.onHome ?? true,
    sort: (last?.sort ?? -1) + 1,
  }).run();
  if (kind === "manual" && input.titleIds)
    await writeItems(db, id, input.titleIds);
  return await getRow(db, id);
}

export async function updateRow(db: MediaDb, id: string, input: RowInput): Promise<RowView> {
  const current = await getRow(db, id);
  const kind = input.kind ?? current.kind;
  const rule = input.rule !== undefined ? input.rule : current.rule;
  assertShape(kind, rule);
  if (input.titleIds)
    await assertTitles(db, input.titleIds);
  await db.update(mediaRows).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.onHome !== undefined ? { onHome: input.onHome } : {}),
    kind,
    rule: kind === "rule" ? JSON.stringify(rule) : null,
    updatedAt: new Date().toISOString(),
  }).where(eq(mediaRows.id, id)).run();
  if (kind === "rule")
    await db.delete(mediaRowItems).where(eq(mediaRowItems.rowId, id)).run();
  else if (input.titleIds)
    await writeItems(db, id, input.titleIds);
  return await getRow(db, id);
}

export async function deleteRow(db: MediaDb, id: string): Promise<RowView> {
  const current = await getRow(db, id);
  await db.delete(mediaRows).where(eq(mediaRows.id, id)).run();
  return current;
}

export async function reorderRows(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaRows).set({ sort: i }).where(eq(mediaRows.id, id))));
}

// ─── Settings ───

export async function getSetting<T>(db: MediaDb, key: string, fallback: T): Promise<T> {
  const row = await db.select().from(mediaSettings).where(eq(mediaSettings.key, key)).get();
  return row ? JSON.parse(row.value) as T : fallback;
}

export async function putSetting(db: MediaDb, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();
  await db.insert(mediaSettings).values({ key, value: json, updatedAt }).onConflictDoUpdate({ target: mediaSettings.key, set: { value: json, updatedAt } }).run();
}

/** The home page's hero: up to 10 titles, in order. */
export async function getHero(db: MediaDb): Promise<string[]> {
  return await getSetting<string[]>(db, HERO_KEY, []);
}

export async function setHero(db: MediaDb, titleIds: readonly string[]): Promise<string[]> {
  if (titleIds.length > 10)
    throw new AppError("The hero holds at most 10 titles", 422, "HERO_TOO_LONG");
  await assertTitles(db, titleIds);
  const unique = [...new Set(titleIds)];
  await putSetting(db, HERO_KEY, unique);
  return unique;
}
