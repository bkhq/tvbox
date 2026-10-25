import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Hono } from "hono";
import { createDb } from "@/db";
import { createApiToken } from "@/modules/account/tokens/tokens.service";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { tvboxRoutes } from "./tvbox.routes";
import "@/modules/account";
import "@/modules/tvbox";

const noop = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  flush() {},
} as unknown as Logger;

let dir: string;
let db: AppDatabase;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "tvbox-tokens-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function app(): Hono<AppEnv> {
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", { NODE_ENV: "test", TRUST_PROXY: false, BASE_PATH: "" } as unknown as Config);
    c.set("logger", noop);
    await next();
  });
  api.route("/", tvboxRoutes());
  api.onError(errorHandler);
  return new Hono<AppEnv>().route("/api", api);
}

async function tokenFor(role: "admin" | "user", scopes: string[]): Promise<string> {
  const id = `${role}-${scopes.join("-")}`;
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@t.io`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await createApiToken(db, id, { name: "ci", scopes, expiresAt: null })).token;
}

const upstream = JSON.stringify({ name: "xiaosa", url: "https://up.example/api.json" });

function call(token: string, method = "GET", body?: string) {
  return app().request("/api/tvbox/upstreams", {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body
      ? { body }
      : {}),
  });
}

describe("API tokens on the tvbox routes", () => {
  test("tvbox:write lets CI manage upstreams as its admin owner", async () => {
    const token = await tokenFor("admin", ["tvbox:write"]);
    expect((await call(token, "POST", upstream)).status).toBe(201);
    const list = await (await call(token)).json() as { data: { name: string }[] };
    expect(list.data.map(u => u.name)).toEqual(["xiaosa"]);
  });

  test("tvbox:read reads but cannot change anything", async () => {
    const token = await tokenFor("admin", ["tvbox:read"]);
    expect((await call(token)).status).toBe(200);
    expect((await call(token, "POST", upstream)).status).toBe(403);
  });

  test("a non-admin's token is refused even with the scope", async () => {
    const token = await tokenFor("user", ["tvbox:write"]);
    expect((await call(token)).status).toBe(403);
  });
});
