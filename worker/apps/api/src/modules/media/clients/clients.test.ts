import type { MediaDb } from "../db";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Hono } from "hono";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { nanoid } from "@/shared/lib/id";
import { errorHandler } from "@/shared/middleware/error-handler";
import { createTitle, getTitle, updateTitle } from "../catalog/titles.service";
import { setMediaDb } from "../db";
import { readGeneration } from "../generation";
import { importTitles } from "../import/import.service";
import { mediaRoutes } from "../index";
import { openTestDb } from "../test-db";
import { createChannel, createClient, deleteChannel, deleteClient, listChannels, listClients, rotateClientToken, updateClient } from "./clients.service";
import "@/modules/account";

let db: MediaDb;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

describe("channels and clients", () => {
  test("a client needs at least one existing channel", async () => {
    const main = await createChannel(db, { name: "main" });
    await expect(createClient(db, { name: "box", channelIds: [] })).rejects.toMatchObject({ code: "CHANNEL_REQUIRED" });
    await expect(createClient(db, {
      name: "box",
      channelIds: ["nope"],
    })).rejects.toMatchObject({ statusCode: 404 });
    const box = await createClient(db, {
      name: "box",
      channelIds: [main.id, main.id],
    });
    expect(box).toMatchObject({
      name: "box",
      enabled: true,
      note: "",
      channelIds: [main.id],
    });
    expect(box.token).toMatch(/^[0-9a-f]{32}$/);
    expect("tokenHash" in box).toBe(false);
    await expect(updateClient(db, box.id, { channelIds: [] })).rejects.toMatchObject({ code: "CHANNEL_REQUIRED" });
    expect(await updateClient(db, box.id, { name: "tv", note: "lobby", enabled: false })).toMatchObject({
      name: "tv",
      note: "lobby",
      enabled: false,
      channelIds: [main.id],
    });
  });

  test("a client's last channel cannot be deleted; otherwise titles and clients lose it", async () => {
    const main = await createChannel(db, { name: "main" });
    const vip = await createChannel(db, { name: "vip" });
    await expect(createChannel(db, { name: "vip" })).rejects.toMatchObject({ code: "CHANNEL_EXISTS" });
    const only = await createClient(db, {
      name: "only",
      channelIds: [vip.id],
    });
    const both = await createClient(db, {
      name: "both",
      channelIds: [main.id, vip.id],
    });
    const t = await createTitle(db, {
      kind: "movie",
      categoryId: "movie",
      title: "片",
      channelIds: [vip.id],
    });
    expect((await listChannels(db)).find(c => c.id === vip.id)).toMatchObject({ titleCount: 1, clientCount: 2 });

    await expect(deleteChannel(db, vip.id)).rejects.toMatchObject({ code: "CHANNEL_IN_USE" });
    await deleteClient(db, only.id);
    await deleteChannel(db, vip.id);
    expect((await listClients(db)).map(c => [c.id, c.channelIds])).toEqual([
      [
        both.id,
        [main.id],
      ],
    ]);
    expect((await getTitle(db, t.id)).channelIds).toEqual([]);
  });

  test("rotating a token replaces it", async () => {
    const main = await createChannel(db, { name: "main" });
    const box = await createClient(db, {
      name: "box",
      channelIds: [main.id],
    });
    const rotated = await rotateClientToken(db, box.id);
    expect(rotated.token).not.toBe(box.token);
  });

  test("titles carry public and their channels", async () => {
    const vip = await createChannel(db, { name: "vip" });
    const t = await createTitle(db, { kind: "movie", categoryId: "movie", title: "片" });
    expect(t).toMatchObject({ public: false, channelIds: [] });
    expect(await updateTitle(db, t.id, {
      public: true,
      channelIds: [vip.id],
    })).toMatchObject({
      public: true,
      channelIds: [vip.id],
    });
    await expect(updateTitle(db, t.id, {
      channelIds: ["nope"],
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test("an import marks its titles public only when asked", async () => {
    const title = {
      kind: "movie" as const,
      externalIds: { tmdb: "movie:1" },
      categoryId: "movie",
      title: "片",
    };
    const [created] = await importTitles(db, [title]);
    expect((await getTitle(db, created!.id!)).public).toBe(false);
    expect((await importTitles(db, [title]))[0]!.action).toBe("unchanged");
    expect((await importTitles(db, [
      { ...title, public: true },
    ]))[0]!.action).toBe("updated");
    expect((await getTitle(db, created!.id!)).public).toBe(true);
    // Without the flag the title keeps what it has.
    expect((await importTitles(db, [title]))[0]!.action).toBe("unchanged");
  });
});

describe("the admin router", () => {
  const noopLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    flush() {},
  } as unknown as Logger;
  let app: AppDatabase;
  let dir: string;

  beforeEach(async () => {
    dir = resolve(tmpdir(), `test-media-clients-${Date.now()}-${nanoid()}`);
    mkdirSync(dir, { recursive: true });
    app = await createDb(resolve(dir, "test.db"));
    setMediaDb(db);
  });

  afterEach(() => {
    setMediaDb(null);
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function admin(): Promise<string> {
    const id = nanoid();
    const now = new Date().toISOString();
    await app.insert(users).values({
      id,
      oauthSub: `sub-${id}`,
      username: `u-${id}`,
      name: id,
      email: `${id}@t.io`,
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run();
    return `session_id=${await createSession(app, id, "tok", undefined, 3600)}`;
  }

  function router(): Hono<AppEnv> {
    const r = new Hono<AppEnv>();
    r.use("*", async (c, next) => {
      c.set("db", app);
      c.set("config", { NODE_ENV: "test", TRUST_PROXY: false } as unknown as Config);
      c.set("logger", noopLogger);
      await next();
    });
    r.route("/", mediaRoutes());
    r.onError(errorHandler);
    return r;
  }

  test("successful writes move the generation; reads and failures do not", async () => {
    const r = router();
    const headers = { "Cookie": await admin(), "Content-Type": "application/json" };
    expect(await readGeneration(db)).toBe("0");
    const created = await r.request("/media/channels", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "main" }),
    });
    expect(created.status).toBe(201);
    const first = await readGeneration(db);
    expect(first).not.toBe("0");

    expect((await r.request("/media/channels", { headers })).status).toBe(200);
    expect((await r.request("/media/clients", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "box", channelIds: [] }),
    })).status).toBe(422);
    expect(await readGeneration(db)).toBe(first);

    const { data: channel } = await created.json() as { data: { id: string } };
    const client = await r.request("/media/clients", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "box",
        channelIds: [channel.id],
      }),
    });
    expect(client.status).toBe(201);
    expect(await readGeneration(db)).not.toBe(first);
  });
});
