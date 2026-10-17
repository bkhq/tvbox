import type { MediaDb } from "./db";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { seedTaxonomy } from "./taxonomy/taxonomy.service";

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../d1/media");

/** A fresh media database (the D1 schema on libsql) with the default categories and genres, for tests. */
export async function openTestDb(): Promise<{ db: MediaDb; dispose: () => void }> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort())
    await client.executeMultiple(readFileSync(join(MIGRATIONS, file), "utf8"));
  const db = drizzle(client, { schema });
  await seedTaxonomy(db);
  return {
    db,
    dispose: () => client.close(),
  };
}
