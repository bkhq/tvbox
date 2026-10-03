import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { describeRoute, errors, jsonCreated, jsonOk, SECURITY, TAGS, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { serviceTokenRequired } from "@/shared/middleware/service-token";
import { CHANNELS, deleteRelease, listReleases, registerRelease, updateRelease } from "./release.service";

const flavorPart = z.string().regex(/^[a-z0-9_]{1,32}$/);
const channelSchema = z.enum(CHANNELS);

const assetSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  mode: z.string(),
  abi: z.string(),
  sha256: z.string(),
  size: z.number(),
});

const releaseSchema = z.object({
  id: z.string(),
  versionCode: z.number(),
  versionName: z.string(),
  channel: channelSchema,
  notes: z.string(),
  withdrawn: z.boolean(),
  createdAt: z.string(),
  assets: z.array(assetSchema),
});

const registerSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().trim().min(1).max(50),
  channel: channelSchema.default("stable"),
  notes: z.string().max(10_000).default(""),
  assets: z.array(z.object({
    mode: flavorPart,
    abi: flavorPart,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive(),
  })).min(1).max(32),
});

const idParam = z.object({ id: z.string() });

/** CI registers a release here after uploading its APKs to the bucket. */
export function releaseRawRoutes() {
  const router = new Hono<AppEnv>();

  router.post(
    "/releases",
    describeRoute({
      tags: [TAGS.Tvbox],
      summary: "Register an app release",
      description: "Records a release whose APKs are already at `tvbox/releases/<versionCode>/<mode>-<abi>.apk` in the bucket, and republishes the update manifests. Re-registering a version replaces it. Authorized by the `release` service token.",
      security: SECURITY.serviceToken,
      responses: { ...jsonCreated(releaseSchema, "Release registered"), ...errors(401, 422, 503) },
    }),
    serviceTokenRequired("release"),
    validator("json", registerSchema),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const release = await registerRelease(db, body, c.get("config").TVBOX_RELEASE_KEEP);
      await audit(db, c.get("logger"), {
        actorId: "service:release",
        actorName: "release service token",
        action: "tvbox.release.registered",
        resourceType: "tvbox_release",
        resourceId: release.id,
        resourceName: release.versionName,
        detail: { versionCode: release.versionCode, channel: release.channel, flavors: release.assets.length },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: release }, 201);
    },
  );

  return router;
}

export function releaseRoutes() {
  const router = new Hono<AppEnv>();
  router.use("/tvbox/releases/*", authRequired, adminRequired);
  router.use("/tvbox/releases", authRequired, adminRequired);

  const doc = (summary: string, responses: ReturnType<typeof jsonOk>) =>
    describeRoute({ tags: [TAGS.Tvbox], summary, security: SECURITY.session, responses: { ...responses, ...errors(401, 403, 404, 422) } });

  const record = async (c: Context<AppEnv>, action: string, release: { id: string; versionName: string }, detail?: Record<string, unknown>) => {
    const user = c.get("user")!;
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action,
      resourceType: "tvbox_release",
      resourceId: release.id,
      resourceName: release.versionName,
      ...(detail ? { detail } : {}),
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });
  };

  router.get("/tvbox/releases", doc("List app releases, newest first", jsonOk(z.array(releaseSchema))), async c =>
    c.json({ success: true, data: await listReleases(c.get("db")) }));

  router.patch(
    "/tvbox/releases/:id",
    doc("Change a release's channel or notes, or withdraw it", jsonOk(releaseSchema)),
    validator("param", idParam),
    validator("json", z.object({ channel: channelSchema.optional(), notes: z.string().max(10_000).optional(), withdrawn: z.boolean().optional() })),
    async (c) => {
      const release = await updateRelease(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
      await record(c, "tvbox.release.updated", release, c.req.valid("json"));
      return c.json({ success: true, data: release });
    },
  );

  router.delete("/tvbox/releases/:id", doc("Delete a release and its APKs", jsonOk(releaseSchema)), validator("param", idParam), async (c) => {
    const release = await deleteRelease(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.release.deleted", release);
    return c.json({ success: true, data: release });
  });

  return router;
}
