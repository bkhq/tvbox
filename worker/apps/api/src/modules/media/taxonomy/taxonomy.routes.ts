import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { TITLE_KINDS } from "../schema";
import { doc, idParam, nameText, record, reorderBody } from "../shared/http";
import {
  CATEGORY_ID,
  createCategory,
  createGenre,
  deleteCategory,
  deleteGenre,
  FACETS,
  listCategories,
  listGenres,
  reorderCategories,
  reorderGenres,
  updateCategory,
  updateGenre,
} from "./taxonomy.service";

const kinds = z.array(z.enum(TITLE_KINDS)).min(1).max(2);
const filters = z.array(z.enum(FACETS)).max(FACETS.length);

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  kinds: z.array(z.enum(TITLE_KINDS)),
  filters: z.array(z.enum(FACETS)),
  sort: z.number(),
  titleCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const genreSchema = z.object({
  id: z.string(),
  name: z.string(),
  tmdbId: z.number().nullable(),
  sort: z.number(),
});

export function taxonomyRoutes() {
  const router = new Hono<AppEnv>();

  router.get("/media/categories", doc("List categories", jsonOk(z.array(categorySchema))), async c =>
    c.json({ success: true, data: await listCategories(c.get("db")) }));

  router.post(
    "/media/categories",
    doc("Add a category", jsonCreated(categorySchema)),
    validator("json", z.object({ id: z.string().regex(CATEGORY_ID), name: nameText, kinds, filters: filters.optional() })),
    async (c) => {
      const row = await createCategory(c.get("db"), c.req.valid("json"));
      await record(c, "media.category.created", { type: "media_category", id: row.id, name: row.name });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.post("/media/categories/reorder", doc("Reorder categories", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderCategories(c.get("db"), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch(
    "/media/categories/:id",
    doc("Update a category", jsonOk(categorySchema)),
    validator("param", idParam),
    validator("json", z.object({ name: nameText.optional(), kinds: kinds.optional(), filters: filters.optional() })),
    async (c) => {
      const row = await updateCategory(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
      await record(c, "media.category.updated", { type: "media_category", id: row.id, name: row.name });
      return c.json({ success: true, data: row });
    },
  );

  router.delete("/media/categories/:id", doc("Delete an empty category", jsonOk(categorySchema)), validator("param", idParam), async (c) => {
    const row = await deleteCategory(c.get("db"), c.req.valid("param").id);
    await record(c, "media.category.deleted", { type: "media_category", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get("/media/genres", doc("List genres", jsonOk(z.array(genreSchema))), async c =>
    c.json({ success: true, data: await listGenres(c.get("db")) }));

  router.post(
    "/media/genres",
    doc("Add a genre", jsonCreated(genreSchema)),
    validator("json", z.object({ name: nameText, tmdbId: z.number().int().positive().nullable().optional() })),
    async (c) => {
      const row = await createGenre(c.get("db"), c.req.valid("json"));
      await record(c, "media.genre.created", { type: "media_genre", id: row.id, name: row.name });
      return c.json({ success: true, data: row }, 201);
    },
  );

  router.post("/media/genres/reorder", doc("Reorder genres", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderGenres(c.get("db"), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch("/media/genres/:id", doc("Rename a genre", jsonOk(genreSchema)), validator("param", idParam), validator("json", z.object({ name: nameText.optional() })), async (c) => {
    const row = await updateGenre(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.genre.updated", { type: "media_genre", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/genres/:id", doc("Delete a genre (titles lose it)", jsonOk(genreSchema)), validator("param", idParam), async (c) => {
    const row = await deleteGenre(c.get("db"), c.req.valid("param").id);
    await record(c, "media.genre.deleted", { type: "media_genre", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  return router;
}
