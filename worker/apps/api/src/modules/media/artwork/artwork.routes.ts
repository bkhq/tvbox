import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { storeUpload } from "@/modules/tvbox/upload.service";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { EXTERNAL_OWNER_TYPES, EXTERNAL_SOURCES, IMAGE_KINDS, IMAGE_OWNER_TYPES } from "../schema";
import { addExternalId, deleteExternalId, listExternalIds } from "../shared/external-ids";
import { doc, httpUrl, idParam, record } from "../shared/http";
import { addImage, deleteImage, listImages, updateImage } from "./images.service";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const imageSchema = z.object({
  id: z.string(),
  ownerType: z.enum(IMAGE_OWNER_TYPES),
  ownerId: z.string(),
  kind: z.enum(IMAGE_KINDS),
  url: z.string().nullable(),
  assetSha256: z.string().nullable(),
  assetName: z.string().nullable(),
  locale: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  isPrimary: z.boolean(),
  sort: z.number(),
  createdAt: z.string(),
});

const externalIdSchema = z.object({
  id: z.string(),
  ownerType: z.enum(EXTERNAL_OWNER_TYPES),
  ownerId: z.string(),
  source: z.enum(EXTERNAL_SOURCES),
  externalId: z.string(),
});

const imageFields = z.object({
  url: httpUrl.nullable().optional(),
  assetSha256: sha256.nullable().optional(),
  assetName: z.string().regex(/^[\w.-]{1,100}$/).nullable().optional(),
  locale: z.string().max(10).nullable().optional(),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export function artworkRoutes() {
  const router = new Hono<AppEnv>();

  router.get(
    "/media/images",
    doc("List an owner's images", jsonOk(z.array(imageSchema))),
    validator("query", z.object({ ownerType: z.enum(IMAGE_OWNER_TYPES), ownerId: z.string().min(1).max(64) })),
    async (c) => {
      const { ownerType, ownerId } = c.req.valid("query");
      return c.json({ success: true, data: await listImages(c.get("db"), ownerType, ownerId) });
    },
  );

  router.post(
    "/media/images",
    doc("Add an image by URL or by an uploaded asset; the first of a kind is primary", jsonCreated(imageSchema)),
    validator("json", imageFields.extend({ ownerType: z.enum(IMAGE_OWNER_TYPES), ownerId: z.string().min(1).max(64), kind: z.enum(IMAGE_KINDS) })),
    async (c) => {
      const { ownerType, ownerId, ...input } = c.req.valid("json");
      const row = await addImage(c.get("db"), ownerType, ownerId, input);
      await record(c, "media.image.added", { type: "media_image", id: row.id, name: row.kind }, { ownerType, ownerId });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.post(
    "/media/images/upload",
    doc("Upload an image file; reference it with the returned sha256 and name", jsonCreated(z.object({ sha256: z.string(), name: z.string(), path: z.string(), size: z.number() }))),
    validator("query", z.object({ name: z.string().min(1).max(200) })),
    async (c) => {
      const stored = await storeUpload(c.get("db"), c.req.valid("query").name, await c.req.arrayBuffer());
      await record(c, "media.image.uploaded", { type: "media_image", id: stored.sha256, name: stored.name }, { size: stored.size });
      return c.json({ success: true, data: { sha256: stored.sha256, name: stored.name, path: stored.path, size: stored.size } }, 201);
    },
  );

  router.patch(
    "/media/images/:id",
    doc("Update an image or make it primary", jsonOk(imageSchema)),
    validator("param", idParam),
    validator("json", imageFields.extend({ sort: z.number().int().optional() })),
    async (c) => {
      const row = await updateImage(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
      await record(c, "media.image.updated", { type: "media_image", id: row.id, name: row.kind }, { ownerType: row.ownerType, ownerId: row.ownerId });
      return c.json({ success: true, data: row });
    },
  );

  router.delete("/media/images/:id", doc("Delete an image", jsonOk(imageSchema)), validator("param", idParam), async (c) => {
    const row = await deleteImage(c.get("db"), c.req.valid("param").id);
    await record(c, "media.image.deleted", { type: "media_image", id: row.id, name: row.kind }, { ownerType: row.ownerType, ownerId: row.ownerId });
    return c.json({ success: true, data: row });
  });

  router.get(
    "/media/external-ids",
    doc("List an owner's external ids", jsonOk(z.array(externalIdSchema))),
    validator("query", z.object({ ownerType: z.enum(EXTERNAL_OWNER_TYPES), ownerId: z.string().min(1).max(64) })),
    async (c) => {
      const { ownerType, ownerId } = c.req.valid("query");
      return c.json({ success: true, data: await listExternalIds(c.get("db"), ownerType, ownerId) });
    },
  );

  router.post(
    "/media/external-ids",
    doc("Link an external id (TMDB, IMDb, TVDB, Douban)", jsonCreated(externalIdSchema)),
    validator("json", z.object({
      ownerType: z.enum(EXTERNAL_OWNER_TYPES),
      ownerId: z.string().min(1).max(64),
      source: z.enum(EXTERNAL_SOURCES),
      externalId: z.string().trim().min(1).max(64),
    })),
    async (c) => {
      const { ownerType, ownerId, ...input } = c.req.valid("json");
      const row = await addExternalId(c.get("db"), ownerType, ownerId, input);
      await record(c, "media.external_id.added", { type: "media_external_id", id: row.id, name: `${row.source}:${row.externalId}` }, { ownerType, ownerId });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.delete("/media/external-ids/:id", doc("Unlink an external id", jsonOk(externalIdSchema)), validator("param", idParam), async (c) => {
    const row = await deleteExternalId(c.get("db"), c.req.valid("param").id);
    await record(c, "media.external_id.deleted", { type: "media_external_id", id: row.id, name: `${row.source}:${row.externalId}` }, { ownerType: row.ownerType, ownerId: row.ownerId });
    return c.json({ success: true, data: row });
  });

  return router;
}
