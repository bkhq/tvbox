import type { Context } from "hono";
import type { jsonOk } from "@/shared/lib/openapi";
import type { AppEnv } from "@/shared/lib/types";
import { z } from "zod";
import { audit, auditMeta } from "@/modules/audit/audit.service";
import { describeRoute, errors, SECURITY, TAGS } from "@/shared/lib/openapi";

type ResponsesMap = ReturnType<typeof jsonOk>;

/** Admin route docs for the media module. */
export function doc(summary: string, responses: ResponsesMap) {
  return describeRoute({
    tags: [TAGS.Media],
    summary,
    security: SECURITY.session,
    responses: {
      ...responses,
      ...errors(401, 403, 404, 409, 422),
    },
  });
}

export async function record(
  c: Context<AppEnv>,
  action: string,
  resource: { type: string; id: string | number; name: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  const user = c.get("user")!;
  await audit(c.get("db"), c.get("logger"), {
    actorId: user.id,
    actorName: user.name,
    action,
    resourceType: resource.type,
    resourceId: String(resource.id),
    resourceName: resource.name,
    ...(detail
      ? { detail }
      : {}),
    ...auditMeta(c),
    result: "success",
  });
}

export const idParam = z.object({
  id: z.string().min(1).max(64),
});
export const httpUrl = z.string().max(2000).url().refine(u => /^https?:\/\//.test(u), "must be an http(s) URL");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const nullableText = (max: number) => z.string().trim().max(max).nullable();
export const nameText = z.string().trim().min(1).max(200);
export const reorderBody = z.object({
  ids: z.array(z.string()).min(1).max(1000),
});
