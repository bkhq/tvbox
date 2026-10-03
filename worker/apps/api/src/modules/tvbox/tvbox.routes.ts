import type { Context } from "hono";
import type { JsonObject } from "./parse";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { describeRoute, errors, jsonCreated, jsonOk, SECURITY, TAGS, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { createDevice, deleteDevice, deviceUpstreams, getDevice, listDevices, rotateDevice, updateDevice } from "./devices.service";
import { linkedApps } from "./enroll.service";
import { applyHealth } from "./health.service";
import { LIST_KINDS } from "./parse";
import { buildConfig, listPublishes, publish, restorePublish } from "./publish.service";
import { syncUpstream } from "./sync.service";
import {
  createEntry,
  createUpstream,
  deleteEntry,
  deleteGlobal,
  deleteUpstream,
  getUpstream,
  listEntries,
  listGlobals,
  listUpstreams,
  putGlobal,
  reorderEntries,
  revertEntry,
  revertGlobal,
  setEntriesEnabled,
  updateEntry,
  updateUpstream,
} from "./tvbox.service";
import { storeUpload } from "./upload.service";

const kindSchema = z.enum(LIST_KINDS);
const jsonObject = z.record(z.string(), z.unknown());
const idParam = z.object({ id: z.string() });
const keyParam = z.object({ key: z.string().min(1).max(100) });
const httpUrl = z.string().url().refine(u => u.startsWith("https://") || u.startsWith("http://"), "must be an http(s) URL");

const upstreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  isPrimary: z.boolean(),
  syncEnabled: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  lastStatus: z.enum(["ok", "error"]).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  entryCount: z.number().optional(),
  deviceCount: z.number().optional(),
});

const entrySchema = z.object({
  id: z.string(),
  kind: kindSchema,
  upstreamId: z.string().nullable(),
  upstreamKey: z.string().nullable(),
  data: jsonObject,
  upstreamData: jsonObject.nullable(),
  enabled: z.boolean(),
  sort: z.number(),
  locallyModified: z.boolean(),
  upstreamRemoved: z.boolean(),
  healthStatus: z.enum(["ok", "blocked", "fail", "skip"]).nullable(),
  healthDetail: z.string().nullable(),
  healthCheckedAt: z.string().nullable(),
  disabledByHealth: z.boolean(),
  healthExempt: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const globalSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  upstreamValue: z.unknown(),
  locallyModified: z.boolean(),
  sort: z.number(),
  updatedAt: z.string(),
});

const publishSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  size: z.number(),
  counts: z.string(),
  trigger: z.enum(["manual", "sync", "restore"]),
  restoredFrom: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string().nullable(),
  hint: z.string(),
  enabled: z.boolean(),
  allUpstreams: z.boolean(),
  upstreamIds: z.array(z.string()),
  note: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  /** The app linked through Server link, most recently seen. */
  link: z.object({
    model: z.string(),
    name: z.string(),
    versionName: z.string(),
    mode: z.string(),
    abi: z.string(),
    lastSeenAt: z.string(),
  }).nullable().optional(),
});

const upstreamIdsSchema = z.array(z.string()).max(100).nullable();

const syncResultSchema = z.object({
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
  assets: z.object({ mirrored: z.number(), failed: z.array(z.string()) }),
});

const nameSchema = z.string().trim().min(1).max(100);

async function record(
  c: Context<AppEnv>,
  action: string,
  resource: { type: string; id: string; name: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  const user = c.get("user")!;
  await audit(c.get("db"), c.get("logger"), {
    actorId: user.id,
    actorName: user.name,
    action,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    ...(detail ? { detail } : {}),
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
    result: "success",
  });
}

function entryName(data: JsonObject, fallback: string): string {
  const name = data.name ?? data.key;
  return typeof name === "string" ? name : fallback;
}

export function tvboxRoutes() {
  const router = new Hono<AppEnv>();

  // Scoped to this module's own paths, admin only throughout.
  router.use("/tvbox/*", authRequired, adminRequired);

  const doc = (summary: string, responses: ReturnType<typeof jsonOk>) =>
    describeRoute({ tags: [TAGS.Tvbox], summary, security: SECURITY.session, responses: { ...responses, ...errors(401, 403, 404, 409, 422) } });

  // ─── Upstreams ───

  router.get("/tvbox/upstreams", doc("List upstreams", jsonOk(z.array(upstreamSchema))), async c =>
    c.json({ success: true, data: await listUpstreams(c.get("db")) }));

  router.post(
    "/tvbox/upstreams",
    doc("Add an upstream", jsonCreated(upstreamSchema)),
    validator("json", z.object({ name: nameSchema, url: httpUrl, syncEnabled: z.boolean().optional() })),
    async (c) => {
      const row = await createUpstream(c.get("db"), c.req.valid("json"));
      await record(c, "tvbox.upstream.created", { type: "tvbox_upstream", id: row.id, name: row.name }, { url: row.url });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.patch(
    "/tvbox/upstreams/:id",
    doc("Update an upstream", jsonOk(upstreamSchema)),
    validator("param", idParam),
    validator("json", z.object({
      name: nameSchema.optional(),
      url: httpUrl.optional(),
      syncEnabled: z.boolean().optional(),
      isPrimary: z.literal(true).optional(),
    })),
    async (c) => {
      const row = await updateUpstream(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
      await record(c, "tvbox.upstream.updated", { type: "tvbox_upstream", id: row.id, name: row.name }, c.req.valid("json"));
      return c.json({ success: true, data: row });
    },
  );

  router.delete("/tvbox/upstreams/:id", doc("Remove an upstream and its entries", jsonOk(upstreamSchema)), validator("param", idParam), async (c) => {
    const row = await deleteUpstream(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.upstream.deleted", { type: "tvbox_upstream", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.post("/tvbox/upstreams/:id/sync", doc("Pull an upstream now (does not publish)", jsonOk(syncResultSchema)), validator("param", idParam), async (c) => {
    const db = c.get("db");
    const upstream = await getUpstream(db, c.req.valid("param").id);
    const result = await syncUpstream(db, upstream.id, { logger: c.get("logger") });
    await record(c, "tvbox.upstream.synced", { type: "tvbox_upstream", id: upstream.id, name: upstream.name }, { ...result });
    return c.json({ success: true, data: result });
  });

  // ─── Entries ───

  router.get(
    "/tvbox/entries",
    doc("List entries", jsonOk(z.array(entrySchema))),
    validator("query", z.object({ kind: kindSchema.optional(), source: z.string().min(1).optional() })),
    async (c) => {
      const { kind, source } = c.req.valid("query");
      return c.json({ success: true, data: await listEntries(c.get("db"), kind, source) });
    },
  );

  router.post(
    "/tvbox/entries",
    doc("Add a local entry", jsonCreated(entrySchema)),
    validator("json", z.object({ kind: kindSchema, data: jsonObject, enabled: z.boolean().optional() })),
    async (c) => {
      const { kind, data, enabled } = c.req.valid("json");
      const row = await createEntry(c.get("db"), kind, data, enabled);
      await record(c, "tvbox.entry.created", { type: "tvbox_entry", id: row.id, name: entryName(row.data, row.id) }, { kind });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.post(
    "/tvbox/entries/reorder",
    doc("Reorder the entries of one kind", jsonOk(z.object({ count: z.number() }))),
    validator("json", z.object({ kind: kindSchema, ids: z.array(z.string()).min(1).max(5000) })),
    async (c) => {
      const { kind, ids } = c.req.valid("json");
      await reorderEntries(c.get("db"), kind, ids);
      return c.json({ success: true, data: { count: ids.length } });
    },
  );

  router.post(
    "/tvbox/entries/bulk",
    doc("Enable or disable many entries", jsonOk(z.object({ count: z.number() }))),
    validator("json", z.object({ ids: z.array(z.string()).min(1).max(5000), enabled: z.boolean() })),
    async (c) => {
      const { ids, enabled } = c.req.valid("json");
      const n = await setEntriesEnabled(c.get("db"), ids, enabled);
      await record(c, "tvbox.entries.bulk", { type: "tvbox_entry", id: "bulk", name: `${n} entries` }, { enabled, count: n });
      return c.json({ success: true, data: { count: n } });
    },
  );

  router.patch(
    "/tvbox/entries/:id",
    doc("Edit or enable/disable an entry", jsonOk(entrySchema)),
    validator("param", idParam),
    validator("json", z.object({ data: jsonObject.optional(), enabled: z.boolean().optional(), healthExempt: z.boolean().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const row = await updateEntry(c.get("db"), c.req.valid("param").id, body);
      await record(c, "tvbox.entry.updated", { type: "tvbox_entry", id: row.id, name: entryName(row.data, row.id) }, {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.healthExempt !== undefined ? { healthExempt: body.healthExempt } : {}),
        dataChanged: body.data !== undefined,
      });
      return c.json({ success: true, data: row });
    },
  );

  router.post("/tvbox/entries/:id/revert", doc("Drop the local edit and follow the upstream", jsonOk(entrySchema)), validator("param", idParam), async (c) => {
    const row = await revertEntry(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.entry.reverted", { type: "tvbox_entry", id: row.id, name: entryName(row.data, row.id) });
    return c.json({ success: true, data: row });
  });

  router.delete("/tvbox/entries/:id", doc("Delete a local entry", jsonOk(entrySchema)), validator("param", idParam), async (c) => {
    const row = await deleteEntry(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.entry.deleted", { type: "tvbox_entry", id: row.id, name: entryName(row.data, row.id) });
    return c.json({ success: true, data: row });
  });

  // ─── Health ───

  router.post(
    "/tvbox/health",
    doc("Record a health run: failing entries are disabled, recovered ones enabled (does not publish)", jsonOk(z.object({
      recorded: z.number(),
      disabled: z.array(z.string()),
      enabled: z.array(z.string()),
    }))),
    validator("json", z.object({
      results: z.array(z.object({
        id: z.string(),
        status: z.enum(["ok", "blocked", "fail", "skip"]),
        detail: z.string().max(4000),
      })).max(5000),
    })),
    async (c) => {
      const outcome = await applyHealth(c.get("db"), c.req.valid("json").results);
      await record(c, "tvbox.health.applied", { type: "tvbox_health", id: "run", name: `${outcome.recorded} entries` }, {
        disabled: outcome.disabled.length,
        enabled: outcome.enabled.length,
      });
      return c.json({ success: true, data: outcome });
    },
  );

  // ─── Globals ───

  router.get("/tvbox/globals", doc("List top-level fields", jsonOk(z.array(globalSchema))), async c =>
    c.json({ success: true, data: await listGlobals(c.get("db")) }));

  router.put(
    "/tvbox/globals/:key",
    doc("Set a top-level field", jsonOk(globalSchema)),
    validator("param", keyParam),
    validator("json", z.object({ value: z.unknown() })),
    async (c) => {
      const { key } = c.req.valid("param");
      if (LIST_KINDS.includes(key as never))
        return c.json({ success: false, error: { code: "INVALID_KEY", message: `"${key}" is edited as entries` } }, 422);
      const row = await putGlobal(c.get("db"), key, c.req.valid("json").value);
      await record(c, "tvbox.global.updated", { type: "tvbox_global", id: key, name: key });
      return c.json({ success: true, data: row });
    },
  );

  router.post("/tvbox/globals/:key/revert", doc("Drop the local value and follow the upstream", jsonOk(globalSchema)), validator("param", keyParam), async (c) => {
    const { key } = c.req.valid("param");
    const row = await revertGlobal(c.get("db"), key);
    await record(c, "tvbox.global.reverted", { type: "tvbox_global", id: key, name: key });
    return c.json({ success: true, data: row });
  });

  router.delete("/tvbox/globals/:key", doc("Delete a field added here", jsonOk(globalSchema)), validator("param", keyParam), async (c) => {
    const { key } = c.req.valid("param");
    const row = await deleteGlobal(c.get("db"), key);
    await record(c, "tvbox.global.deleted", { type: "tvbox_global", id: key, name: key });
    return c.json({ success: true, data: row });
  });

  // ─── Files of our own ───

  router.post(
    "/tvbox/files",
    doc("Upload a file (logo, wallpaper, spider…) to serve under every subscription", jsonCreated(z.object({
      path: z.string(),
      name: z.string(),
      sha256: z.string(),
      md5: z.string(),
      size: z.number(),
    }))),
    validator("query", z.object({ name: z.string().min(1).max(200) })),
    async (c) => {
      const { name } = c.req.valid("query");
      const stored = await storeUpload(c.get("db"), name, await c.req.arrayBuffer());
      await record(c, "tvbox.file.uploaded", { type: "tvbox_file", id: stored.sha256, name: stored.name }, { size: stored.size });
      return c.json({ success: true, data: stored }, 201);
    },
  );

  // ─── Publishing ───

  router.get(
    "/tvbox/preview",
    doc("The config as it would be published now, for one device or for every upstream", jsonOk(jsonObject)),
    validator("query", z.object({ deviceId: z.string().optional() })),
    async (c) => {
      const db = c.get("db");
      const { deviceId } = c.req.valid("query");
      const upstreams = deviceId ? deviceUpstreams(await getDevice(db, deviceId)) : null;
      return c.json({ success: true, data: await buildConfig(db, upstreams) });
    },
  );

  router.get("/tvbox/publishes", doc("Publish history, newest first", jsonOk(z.array(publishSchema))), async c =>
    c.json({ success: true, data: await listPublishes(c.get("db")) }));

  router.post("/tvbox/publishes", doc("Publish the current config", jsonCreated(publishSchema)), async (c) => {
    const user = c.get("user")!;
    const row = await publish(c.get("db"), { trigger: "manual", userId: user.id });
    await record(c, "tvbox.published", { type: "tvbox_publish", id: row.id, name: row.id }, { counts: JSON.parse(row.counts) as unknown });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/tvbox/publishes/:id/restore", doc("Publish an earlier version again", jsonCreated(publishSchema)), validator("param", idParam), async (c) => {
    const user = c.get("user")!;
    const row = await restorePublish(c.get("db"), c.req.valid("param").id, user.id);
    await record(c, "tvbox.publish.restored", { type: "tvbox_publish", id: row.id, name: row.id }, { restoredFrom: row.restoredFrom });
    return c.json({ success: true, data: row }, 201);
  });

  // ─── Devices ───

  router.get("/tvbox/devices", doc("List devices, their subscription URLs and linked apps", jsonOk(z.array(deviceSchema))), async (c) => {
    const db = c.get("db");
    const links = await linkedApps(db);
    const data = (await listDevices(db)).map((d) => {
      const l = links.get(d.id);
      return { ...d, link: l ? { model: l.model, name: l.name, versionName: l.versionName, mode: l.mode, abi: l.abi, lastSeenAt: l.lastSeenAt } : null };
    });
    return c.json({ success: true, data });
  });

  router.post(
    "/tvbox/devices",
    doc("Add a device", jsonCreated(deviceSchema)),
    validator("json", z.object({ name: nameSchema, note: z.string().max(500).optional(), upstreamIds: upstreamIdsSchema.default(null) })),
    async (c) => {
      const device = await createDevice(c.get("db"), c.req.valid("json"), c.get("user")!.id);
      await record(c, "tvbox.device.created", { type: "tvbox_device", id: device.id, name: device.name });
      return c.json({ success: true, data: device }, 201);
    },
  );

  router.patch(
    "/tvbox/devices/:id",
    doc("Rename, enable/disable or change a device's upstreams", jsonOk(deviceSchema)),
    validator("param", idParam),
    validator("json", z.object({
      name: nameSchema.optional(),
      note: z.string().max(500).optional(),
      enabled: z.boolean().optional(),
      upstreamIds: upstreamIdsSchema.optional(),
    })),
    async (c) => {
      const body = c.req.valid("json");
      const device = await updateDevice(c.get("db"), c.req.valid("param").id, body);
      await record(c, "tvbox.device.updated", { type: "tvbox_device", id: device.id, name: device.name }, body);
      return c.json({ success: true, data: device });
    },
  );

  router.post("/tvbox/devices/:id/rotate", doc("Give a device a new subscription URL", jsonOk(deviceSchema)), validator("param", idParam), async (c) => {
    const device = await rotateDevice(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.device.rotated", { type: "tvbox_device", id: device.id, name: device.name });
    return c.json({ success: true, data: device });
  });

  router.delete("/tvbox/devices/:id", doc("Delete a device", jsonOk(deviceSchema)), validator("param", idParam), async (c) => {
    const device = await deleteDevice(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.device.deleted", { type: "tvbox_device", id: device.id, name: device.name });
    return c.json({ success: true, data: device });
  });

  return router;
}
