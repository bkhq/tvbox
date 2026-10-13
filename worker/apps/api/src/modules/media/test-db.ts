import type { AppDatabase } from "@/db";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDb } from "@/db";
import { nanoid } from "@/shared/lib/id";
import { seedTaxonomy } from "./taxonomy/taxonomy.service";

/** A fresh migrated database with the default categories and genres, for tests. */
export async function openTestDb(): Promise<{ db: AppDatabase; dispose: () => void }> {
  const dir = resolve(tmpdir(), `test-media-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  const db = await createDb(resolve(dir, "test.db"));
  await seedTaxonomy(db);
  return {
    db,
    dispose: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
