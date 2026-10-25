import type { D1Database } from "@cloudflare/workers-types";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/d1";
import { chunked } from "@/shared/lib/chunk";
import { AppError } from "@/shared/lib/errors";
import * as schema from "./schema";

/**
 * The media library's database: the `MEDIA` D1 binding, read by the Worker,
 * not the Durable Object's SQLite. Spelled in the libsql flavour
 * like `AppDatabase` (the tests run on libsql); the D1 handle is cast once
 * here. D1 has no interactive transactions, so the module writes with
 * `db.batch()` — one atomic unit per call — and never `db.transaction()`.
 * Raw `sql` with parameters cannot join a batch (drizzle's D1 driver prepares
 * no statement for it); run such reads on their own.
 */
export type MediaDb = LibSQLDatabase<typeof schema>;

/** Statements a service collects for one `db.batch()`. */
export type Statement = Parameters<MediaDb["batch"]>[0][number];

export function createMediaDb(d1: unknown): MediaDb {
  return drizzle(d1 as D1Database, { schema }) as unknown as MediaDb;
}

let current: MediaDb | null = null;

/** Installed at boot from the `MEDIA` binding; null where the deployment has none. */
export function setMediaDb(db: MediaDb | null): void {
  current = db;
}

export function getMediaDb(): MediaDb | null {
  return current;
}

export function requireMediaDb(): MediaDb {
  if (!current)
    throw new AppError("This deployment has no media database", 409, "MEDIA_DB_UNAVAILABLE");
  return current;
}

/** Run `statements` as one batch; nothing to run is fine. */
export async function runBatch(db: MediaDb, statements: readonly Statement[]): Promise<void> {
  if (statements.length > 0)
    await db.batch(statements as [Statement, ...Statement[]]);
}

// D1 binds at most 100 parameters per statement.
const MAX_PARAMS = 90;

/**
 * Multi-row inserts of `rows`, each statement within D1's parameter limit.
 * Columns with a default bind a parameter too, so the count comes from the
 * first row's statement rather than from the keys given.
 */
export function insertRows<T extends SQLiteTable>(db: MediaDb, table: T, rows: readonly SQLiteInsertValue<T>[]): Statement[] {
  if (rows.length === 0)
    return [];
  const perRow = db.insert(table).values(rows[0]!).toSQL().params.length;
  return chunked(rows, Math.max(1, Math.floor(MAX_PARAMS / perRow))).map(part => db.insert(table).values(part as SQLiteInsertValue<T>[]));
}
