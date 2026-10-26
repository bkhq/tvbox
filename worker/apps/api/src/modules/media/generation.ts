import type { MediaDb } from "./db";
import { eq } from "drizzle-orm";
import { ulid } from "@/shared/lib/id";
import { mediaSettings } from "./schema";

const GENERATION_KEY = "generation";

/** Moved by every admin write; clients cache by it. "0" before the first write. */
export async function readGeneration(db: MediaDb): Promise<string> {
  const row = await db.select({ value: mediaSettings.value }).from(mediaSettings).where(eq(mediaSettings.key, GENERATION_KEY)).get();
  return row
    ? JSON.parse(row.value) as string
    : "0";
}

export async function bumpGeneration(db: MediaDb): Promise<string> {
  const generation = ulid();
  const value = JSON.stringify(generation);
  await db.insert(mediaSettings).values({ key: GENERATION_KEY, value }).onConflictDoUpdate({
    target: mediaSettings.key,
    set: {
      value,
      updatedAt: new Date().toISOString(),
    },
  });
  return generation;
}
