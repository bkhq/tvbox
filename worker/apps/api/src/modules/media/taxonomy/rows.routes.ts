import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { ROW_KINDS } from "../schema";
import { doc, idParam, nameText, record, reorderBody } from "../shared/http";
import { createRow, deleteRow, getHero, listRows, reorderRows, ROW_SORTS, rowRuleSchema, setHero, updateRow } from "./rows.service";

const ruleSchema = z.object({
  categoryId: z.string().optional(),
  genreId: z.string().optional(),
  kind: z.enum(["movie", "series"]).optional(),
  sort: z.enum(ROW_SORTS),
  limit: z.number(),
});

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(ROW_KINDS),
  rule: ruleSchema.nullable(),
  onHome: z.boolean(),
  sort: z.number(),
  titleIds: z.array(z.number()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const titleIds = z.array(z.number().int().positive()).max(100);

const rowFields = z.object({
  name: nameText,
  kind: z.enum(ROW_KINDS).optional(),
  rule: rowRuleSchema.nullable().optional(),
  onHome: z.boolean().optional(),
  titleIds: titleIds.optional(),
});

export function rowsRoutes() {
  const router = new Hono<AppEnv>();

  router.get("/media/rows", doc("List home rows", jsonOk(z.array(rowSchema))), async c =>
    c.json({ success: true, data: await listRows(c.get("db")) }));

  router.post("/media/rows", doc("Add a home row: hand-picked titles or a rule", jsonCreated(rowSchema)), validator("json", rowFields), async (c) => {
    const row = await createRow(c.get("db"), c.req.valid("json"));
    await record(c, "media.row.created", { type: "media_row", id: row.id, name: row.name }, { kind: row.kind });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/rows/reorder", doc("Reorder home rows", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderRows(c.get("db"), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch("/media/rows/:id", doc("Update a home row", jsonOk(rowSchema)), validator("param", idParam), validator("json", rowFields.partial()), async (c) => {
    const row = await updateRow(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.row.updated", { type: "media_row", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/rows/:id", doc("Delete a home row", jsonOk(rowSchema)), validator("param", idParam), async (c) => {
    const row = await deleteRow(c.get("db"), c.req.valid("param").id);
    await record(c, "media.row.deleted", { type: "media_row", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get("/media/hero", doc("The home page's hero titles", jsonOk(z.object({ titleIds }))), async c =>
    c.json({ success: true, data: { titleIds: await getHero(c.get("db")) } }));

  router.put("/media/hero", doc("Set the home page's hero titles", jsonOk(z.object({ titleIds }))), validator("json", z.object({ titleIds: titleIds.max(10) })), async (c) => {
    const ids = await setHero(c.get("db"), c.req.valid("json").titleIds);
    await record(c, "media.hero.updated", { type: "media_hero", id: "hero", name: `${ids.length} titles` });
    return c.json({ success: true, data: { titleIds: ids } });
  });

  return router;
}
