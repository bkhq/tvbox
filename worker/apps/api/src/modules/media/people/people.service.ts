import type { SQL } from "drizzle-orm";
import type { MediaDb } from "../db";
import { and, asc, count, desc, eq, isNull, like, or } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { mediaId, ulid } from "@/shared/lib/id";
import { runBatch } from "../db";
import { mediaCredits, mediaPeople, mediaSeasons, mediaTitles } from "../schema";
import { deleteOwned } from "../shared/owners";

export type PersonRow = typeof mediaPeople.$inferSelect;
export type CreditRow = typeof mediaCredits.$inferSelect;

export interface PersonInput {
  readonly name?: string | undefined;
  readonly originalName?: string | null | undefined;
  readonly gender?: PersonRow["gender"] | undefined;
  readonly biography?: string | null | undefined;
  readonly birthday?: string | null | undefined;
  readonly placeOfBirth?: string | null | undefined;
}

export interface CreditInput {
  readonly personId?: string | undefined;
  readonly seasonId?: string | null | undefined;
  readonly role?: CreditRow["role"] | undefined;
  readonly character?: string | null | undefined;
  readonly department?: string | null | undefined;
  readonly job?: string | null | undefined;
  readonly sort?: number | undefined;
}

export interface CreditView extends CreditRow {
  readonly personName: string;
}

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ─── People ───

export async function getPerson(db: MediaDb, id: string): Promise<PersonRow> {
  const row = await db.select().from(mediaPeople).where(eq(mediaPeople.id, id)).get();
  if (!row)
    throw new NotFoundError("Person", id);
  return row;
}

export async function listPeople(db: MediaDb, query: { q?: string | undefined; page: number; limit: number }): Promise<{ items: PersonRow[]; total: number }> {
  let condition: SQL | undefined;
  if (query.q) {
    const pattern = `%${query.q}%`;
    condition = or(like(mediaPeople.name, pattern), like(mediaPeople.originalName, pattern));
  }
  const total = (await db.select({ n: count() }).from(mediaPeople).where(condition).get())?.n ?? 0;
  const items = await db.select().from(mediaPeople).where(condition).orderBy(asc(mediaPeople.name), asc(mediaPeople.id)).limit(query.limit).offset((query.page - 1) * query.limit).all();
  return { items, total };
}

export async function createPerson(db: MediaDb, input: PersonInput & { name: string }): Promise<PersonRow> {
  const id = mediaId();
  await db.insert(mediaPeople).values({ ...defined(input), id, name: input.name }).run();
  return await getPerson(db, id);
}

export async function updatePerson(db: MediaDb, id: string, input: PersonInput): Promise<PersonRow> {
  await getPerson(db, id);
  await db.update(mediaPeople).set({ ...defined(input), updatedAt: new Date().toISOString() }).where(eq(mediaPeople.id, id)).run();
  return await getPerson(db, id);
}

/** Their credits go with them. */
export async function deletePerson(db: MediaDb, id: string): Promise<PersonRow> {
  const row = await getPerson(db, id);
  await runBatch(db, [...deleteOwned(db, "person", [id]), db.delete(mediaPeople).where(eq(mediaPeople.id, id))]);
  return row;
}

/** A person's titles, newest first: what the native API's person page lists. */
export async function personCredits(db: MediaDb, id: string): Promise<(CreditRow & { title: string })[]> {
  await getPerson(db, id);
  return await db.select({ credit: mediaCredits, title: mediaTitles.title })
    .from(mediaCredits)
    .innerJoin(mediaTitles, eq(mediaTitles.id, mediaCredits.titleId))
    .where(eq(mediaCredits.personId, id))
    .orderBy(desc(mediaTitles.releaseDate), desc(mediaTitles.id))
    .all()
    .then(rows => rows.map(r => ({ ...r.credit, title: r.title })));
}

// ─── Credits ───

async function getCredit(db: MediaDb, id: string): Promise<CreditView> {
  const row = await db.select({ credit: mediaCredits, personName: mediaPeople.name })
    .from(mediaCredits)
    .innerJoin(mediaPeople, eq(mediaPeople.id, mediaCredits.personId))
    .where(eq(mediaCredits.id, id))
    .get();
  if (!row)
    throw new NotFoundError("Credit", id);
  return { ...row.credit, personName: row.personName };
}

/** `seasonId` undefined: every credit of the title; null: the title-wide ones; an id: that season's. */
export async function listCredits(db: MediaDb, titleId: string, seasonId?: string | null): Promise<CreditView[]> {
  const where = [eq(mediaCredits.titleId, titleId)];
  if (seasonId === null)
    where.push(isNull(mediaCredits.seasonId));
  else if (seasonId !== undefined)
    where.push(eq(mediaCredits.seasonId, seasonId));
  const rows = await db.select({ credit: mediaCredits, personName: mediaPeople.name })
    .from(mediaCredits)
    .innerJoin(mediaPeople, eq(mediaPeople.id, mediaCredits.personId))
    .where(and(...where))
    .orderBy(asc(mediaCredits.role), asc(mediaCredits.sort), asc(mediaCredits.id))
    .all();
  return rows.map(r => ({ ...r.credit, personName: r.personName }));
}

async function assertSeasonOf(db: MediaDb, titleId: string, seasonId: string | null | undefined): Promise<void> {
  if (seasonId == null)
    return;
  const season = await db.select({ titleId: mediaSeasons.titleId }).from(mediaSeasons).where(eq(mediaSeasons.id, seasonId)).get();
  if (!season || season.titleId !== titleId)
    throw new AppError("The season is not one of this title's", 422, "SEASON_MISMATCH");
}

export async function addCredit(db: MediaDb, titleId: string, input: CreditInput & { personId: string; role: CreditRow["role"] }): Promise<CreditView> {
  const title = await db.select({ id: mediaTitles.id }).from(mediaTitles).where(eq(mediaTitles.id, titleId)).get();
  if (!title)
    throw new NotFoundError("Title", titleId);
  await getPerson(db, input.personId);
  await assertSeasonOf(db, titleId, input.seasonId);
  const id = ulid();
  await db.insert(mediaCredits).values({ ...defined(input), id, titleId, personId: input.personId, role: input.role }).run();
  return await getCredit(db, id);
}

export async function updateCredit(db: MediaDb, id: string, input: CreditInput): Promise<CreditView> {
  const current = await getCredit(db, id);
  if (input.personId !== undefined)
    await getPerson(db, input.personId);
  await assertSeasonOf(db, current.titleId, input.seasonId);
  await db.update(mediaCredits).set(defined(input)).where(eq(mediaCredits.id, id)).run();
  return await getCredit(db, id);
}

export async function deleteCredit(db: MediaDb, id: string): Promise<CreditView> {
  const current = await getCredit(db, id);
  await db.delete(mediaCredits).where(eq(mediaCredits.id, id)).run();
  return current;
}

export async function reorderCredits(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaCredits).set({ sort: i }).where(eq(mediaCredits.id, id))));
}
