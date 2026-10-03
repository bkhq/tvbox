import type { JsonObject } from "./parse";
import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { compose } from "./compose";
import { LIST_KINDS } from "./parse";
import { tvboxEntries, tvboxGlobals, tvboxPublishes } from "./schema";
import { CURRENT_CONFIG_KEY, hashHex, publishedConfigKey, putObject, readObjectText } from "./storage";

export type PublishRow = typeof tvboxPublishes.$inferSelect;

/** The config as it would be published right now. */
export async function buildConfig(db: AppDatabase): Promise<JsonObject> {
  const globals = await db.select().from(tvboxGlobals).orderBy(tvboxGlobals.sort, tvboxGlobals.key).all();
  const entries = await db.select().from(tvboxEntries).all();
  return compose({
    globals: globals.map(g => ({ key: g.key, value: JSON.parse(g.value) as unknown })),
    entries: entries.map(e => ({ ...e, data: JSON.parse(e.data) as JsonObject })),
  });
}

interface PublishInput {
  readonly trigger: PublishRow["trigger"];
  readonly userId?: string | undefined;
  readonly restoredFrom?: string | undefined;
}

async function writePublish(db: AppDatabase, json: string, input: PublishInput): Promise<PublishRow> {
  const config = JSON.parse(json) as JsonObject;
  const counts = Object.fromEntries(LIST_KINDS.map(kind => [kind, Array.isArray(config[kind]) ? config[kind].length : 0]));
  const id = ulid();
  // The per-publish copy first: `current` must never name a version that
  // was not stored.
  await putObject(publishedConfigKey(id), json);
  await putObject(CURRENT_CONFIG_KEY, json);
  const row = {
    id,
    sha256: hashHex("sha256", json),
    size: new TextEncoder().encode(json).byteLength,
    counts: JSON.stringify(counts),
    trigger: input.trigger,
    restoredFrom: input.restoredFrom ?? null,
    createdBy: input.userId ?? null,
  };
  await db.insert(tvboxPublishes).values(row).run();
  return (await db.select().from(tvboxPublishes).where(eq(tvboxPublishes.id, id)).get())!;
}

export async function publish(db: AppDatabase, input: Omit<PublishInput, "restoredFrom">): Promise<PublishRow> {
  return await writePublish(db, JSON.stringify(await buildConfig(db)), input);
}

/** Make an earlier version live again, recorded as a new publish. */
export async function restorePublish(db: AppDatabase, id: string, userId: string): Promise<PublishRow> {
  const source = await db.select().from(tvboxPublishes).where(eq(tvboxPublishes.id, id)).get();
  if (!source)
    throw new NotFoundError("Publish");
  const json = await readObjectText(publishedConfigKey(id));
  return await writePublish(db, json, { trigger: "restore", userId, restoredFrom: id });
}

export async function listPublishes(db: AppDatabase, limit = 50): Promise<PublishRow[]> {
  return await db.select().from(tvboxPublishes).orderBy(desc(tvboxPublishes.id)).limit(limit).all();
}
