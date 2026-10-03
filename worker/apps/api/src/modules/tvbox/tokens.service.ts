import type { TokensFile } from "./storage";
import type { AppDatabase } from "@/db";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { tvboxTokens } from "./schema";
import { hashHex, putObject, TOKENS_KEY } from "./storage";

export type TokenRow = typeof tvboxTokens.$inferSelect;
export type TokenView = Omit<TokenRow, "tokenHash">;

function view({ tokenHash: _, ...rest }: TokenRow): TokenView {
  return rest;
}

/**
 * The Worker checks tokens against this file instead of the database, so a
 * subscription request never wakes the Durable Object. Rewritten after
 * every change.
 */
async function writeTokensFile(db: AppDatabase): Promise<void> {
  const rows = await db.select({ hash: tvboxTokens.tokenHash }).from(tvboxTokens).where(eq(tvboxTokens.enabled, true)).all();
  const file: TokensFile = { hashes: rows.map(r => r.hash) };
  await putObject(TOKENS_KEY, JSON.stringify(file));
}

export async function listTokens(db: AppDatabase): Promise<TokenView[]> {
  return (await db.select().from(tvboxTokens).orderBy(desc(tvboxTokens.id)).all()).map(view);
}

/** Returns the plaintext token once; only its hash is kept. */
export async function createToken(db: AppDatabase, name: string, userId: string): Promise<{ token: string; row: TokenView }> {
  const token = randomBytes(16).toString("hex");
  const id = ulid();
  await db.insert(tvboxTokens).values({
    id,
    name,
    tokenHash: hashHex("sha256", token),
    hint: token.slice(-4),
    createdBy: userId,
  }).run();
  await writeTokensFile(db);
  const row = (await db.select().from(tvboxTokens).where(eq(tvboxTokens.id, id)).get())!;
  return { token, row: view(row) };
}

export async function updateToken(db: AppDatabase, id: string, patch: { name?: string | undefined; enabled?: boolean | undefined }): Promise<TokenView> {
  const row = await db.select().from(tvboxTokens).where(eq(tvboxTokens.id, id)).get();
  if (!row)
    throw new NotFoundError("Token");
  await db.update(tvboxTokens).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  }).where(eq(tvboxTokens.id, id)).run();
  await writeTokensFile(db);
  return view((await db.select().from(tvboxTokens).where(eq(tvboxTokens.id, id)).get())!);
}

export async function deleteToken(db: AppDatabase, id: string): Promise<TokenView> {
  const row = await db.select().from(tvboxTokens).where(eq(tvboxTokens.id, id)).get();
  if (!row)
    throw new NotFoundError("Token");
  await db.delete(tvboxTokens).where(eq(tvboxTokens.id, id)).run();
  await writeTokensFile(db);
  return view(row);
}
