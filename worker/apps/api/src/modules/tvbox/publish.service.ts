import type { PublishedSnapshot } from "./compose";
import type { JsonObject } from "./parse";
import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { composeForDevice } from "./compose";
import { LIST_KINDS } from "./parse";
import { tvboxEntries, tvboxGlobals, tvboxPublishes } from "./schema";
import { OWN_JAR, ownJarSpec } from "./spider-jar.service";
import { hashHex, objectExists, PUBLISHED_KEY, publishSnapshotKey, putObject, readObjectText } from "./storage";

export type PublishRow = typeof tvboxPublishes.$inferSelect;

/** The current state, as it would be published. */
export async function buildSnapshot(db: AppDatabase): Promise<PublishedSnapshot> {
  const globals = await db.select().from(tvboxGlobals).orderBy(tvboxGlobals.sort, tvboxGlobals.key).all();
  const entries = await db.select().from(tvboxEntries).where(eq(tvboxEntries.enabled, true)).all();
  const ownJar = await ownJarSpec(db);
  const withJar = (data: JsonObject): JsonObject => data.jar === OWN_JAR && ownJar
    ? { ...data, jar: ownJar }
    : data;
  return {
    version: 2,
    globals: globals.map(g => ({
      key: g.key,
      value: JSON.parse(g.value) as unknown,
    })),
    entries: entries.map(e => ({
      id: e.id,
      kind: e.kind,
      upstreamId: e.upstreamId,
      enabled: true,
      sort: e.sort,
      data: withJar(JSON.parse(e.data) as JsonObject),
    })),
  };
}

/** The config a device on `upstreams` (null: every upstream) would get right now. */
export async function buildConfig(db: AppDatabase, upstreams: readonly string[] | null = null): Promise<JsonObject> {
  return composeForDevice(await buildSnapshot(db), upstreams);
}

interface PublishInput {
  readonly trigger: PublishRow["trigger"];
  readonly userId?: string | undefined;
  readonly restoredFrom?: string | undefined;
}

async function writePublish(db: AppDatabase, snapshot: PublishedSnapshot, input: PublishInput): Promise<PublishRow> {
  const json = JSON.stringify(snapshot);
  const everything = composeForDevice(snapshot, null);
  const counts = Object.fromEntries(LIST_KINDS.map(kind => [
    kind,
    Array.isArray(everything[kind])
      ? everything[kind].length
      : 0,
  ]));
  const id = ulid();
  // The per-publish copy first: the live pointer must never name a version
  // that was not stored.
  await putObject(publishSnapshotKey(id), json);
  await putObject(PUBLISHED_KEY, json);
  await db.insert(tvboxPublishes).values({
    id,
    sha256: hashHex("sha256", json),
    size: new TextEncoder().encode(json).byteLength,
    counts: JSON.stringify(counts),
    trigger: input.trigger,
    restoredFrom: input.restoredFrom ?? null,
    createdBy: input.userId ?? null,
  }).run();
  return (await db.select().from(tvboxPublishes).where(eq(tvboxPublishes.id, id)).get())!;
}

export async function publish(db: AppDatabase, input: Omit<PublishInput, "restoredFrom">): Promise<PublishRow> {
  return await writePublish(db, await buildSnapshot(db), input);
}

/** Make an earlier version live again, recorded as a new publish. */
export async function restorePublish(db: AppDatabase, id: string, userId: string): Promise<PublishRow> {
  const source = await db.select().from(tvboxPublishes).where(eq(tvboxPublishes.id, id)).get();
  if (!source)
    throw new NotFoundError("Publish");
  // Publishes from before devices stored one composed config, which cannot
  // be split per device again.
  if (!(await objectExists(publishSnapshotKey(id))))
    throw new AppError("This version predates devices and cannot be restored", 409, "LEGACY_PUBLISH");
  const snapshot = JSON.parse(await readObjectText(publishSnapshotKey(id))) as PublishedSnapshot;
  return await writePublish(db, snapshot, { trigger: "restore", userId, restoredFrom: id });
}

export async function listPublishes(db: AppDatabase, limit = 50): Promise<PublishRow[]> {
  return await db.select().from(tvboxPublishes).orderBy(desc(tvboxPublishes.id)).limit(limit).all();
}
