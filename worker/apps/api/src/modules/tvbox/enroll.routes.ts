import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit, auditMeta } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { describeRoute, errors, jsonOk, SECURITY, TAGS, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { answerEnroll, approveEnrollment, deleteEnrollment, listEnrollments, RE_ENROLL_CODE, rejectEnrollment } from "./enroll.service";

const text = z.string().max(200).optional();

const enrollSchema = z.object({
  action: z.enum(["request", "unlink"]),
  code: z.string().regex(RE_ENROLL_CODE),
  deviceId: text,
  name: text,
  model: text,
  mode: text,
  abi: text,
  versionCode: z.number().int().nonnegative().optional(),
  versionName: text,
});

const answerSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  subscription: z.string().optional(),
  // With approved, for an app that can send it back as X-Device-Key.
  deviceKey: z.string().optional(),
});

const enrollmentSchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.enum([
    "pending",
    "approved",
    "rejected",
    "unlinked",
  ]),
  deviceRef: z.string().nullable(),
  deviceName: z.string().nullable(),
  appDeviceId: z.string(),
  name: z.string(),
  model: z.string(),
  mode: z.string(),
  abi: z.string(),
  versionCode: z.number(),
  versionName: z.string(),
  ip: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const idParam = z.object({
  id: z.string(),
});

/**
 * The TVBox app's link endpoint. Public: the device code, which only shows on
 * the device's screen, is what an admin approves. The Worker also answers it
 * at the site root (`/api/raw/tvbox/enroll`) so apps never learn the console
 * path.
 */
export function enrollRawRoutes() {
  const router = new Hono<AppEnv>();

  router.post(
    "/tvbox/enroll",
    describeRoute({
      tags: [TAGS.Tvbox],
      summary: "Ask to link a TVBox app, or poll for the answer",
      description: "`request` records the device code and answers `pending`, `approved` (with the subscription URL and, for an app that supports binding, its device key) or `rejected`; `unlink` ends the link from the device.",
      responses: {
        ...jsonOk(answerSchema, "Link state"),
        ...errors(422, 429),
      },
    }),
    validator("json", enrollSchema),
    async (c) => {
      const { action, ...report } = c.req.valid("json");
      const config = c.get("config");
      const origin = config.APP_URL?.replace(/\/+$/, "") ?? new URL(c.req.url).origin;
      return c.json(await answerEnroll(c.get("db"), action, report, getClientIp(c, config), origin));
    },
  );

  return router;
}

export function enrollRoutes() {
  const router = new Hono<AppEnv>();
  router.use("/tvbox/enrollments", authRequired, adminRequired);
  router.use("/tvbox/enrollments/*", authRequired, adminRequired);

  const doc = (summary: string, responses: ReturnType<typeof jsonOk>) =>
    describeRoute({
      tags: [TAGS.Tvbox],
      summary,
      security: SECURITY.session,
      responses: {
        ...responses,
        ...errors(401, 403, 404, 409, 422),
      },
    });

  const record = async (c: Context<AppEnv>, action: string, e: { id: string; code: string }, detail?: Record<string, unknown>) => {
    const user = c.get("user")!;
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action,
      resourceType: "tvbox_enrollment",
      resourceId: e.id,
      resourceName: e.code,
      ...(detail
        ? { detail }
        : {}),
      ...auditMeta(c),
      result: "success",
    });
  };

  router.get("/tvbox/enrollments", doc("Link requests from TVBox apps, pending first", jsonOk(z.array(enrollmentSchema))), async c =>
    c.json({ success: true, data: await listEnrollments(c.get("db")) }));

  router.post(
    "/tvbox/enrollments/:id/approve",
    doc("Approve a link request onto a new or existing device", jsonOk(enrollmentSchema)),
    validator("param", idParam),
    validator("json", z.object({
      deviceId: z.string().optional(),
      name: z.string().trim().max(100).optional(),
      upstreamIds: z.array(z.string()).max(100).nullable().optional(),
    })),
    async (c) => {
      const body = c.req.valid("json");
      const e = await approveEnrollment(c.get("db"), c.req.valid("param").id, body, c.get("user")!.id);
      await record(c, "tvbox.enrollment.approved", e, { deviceId: e.deviceRef, model: e.model });
      return c.json({ success: true, data: e });
    },
  );

  router.post("/tvbox/enrollments/:id/reject", doc("Reject a request or revoke a link", jsonOk(enrollmentSchema)), validator("param", idParam), async (c) => {
    const e = await rejectEnrollment(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.enrollment.rejected", e);
    return c.json({ success: true, data: e });
  });

  router.delete("/tvbox/enrollments/:id", doc("Forget a link request", jsonOk(enrollmentSchema.omit({ deviceName: true }))), validator("param", idParam), async (c) => {
    const e = await deleteEnrollment(c.get("db"), c.req.valid("param").id);
    await record(c, "tvbox.enrollment.deleted", e);
    return c.json({ success: true, data: e });
  });

  return router;
}
