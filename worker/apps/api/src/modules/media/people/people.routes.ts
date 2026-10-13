import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, jsonPaged, validator } from "@/shared/lib/openapi";
import { CREDIT_ROLES } from "../schema";
import { doc, idParam, intParam, isoDate, nameText, nullableText, record, reorderBody } from "../shared/http";
import {
  addCredit,
  createPerson,
  deleteCredit,
  deletePerson,
  getPerson,
  listCredits,
  listPeople,
  personCredits,
  reorderCredits,
  updateCredit,
  updatePerson,
} from "./people.service";

const personSchema = z.object({
  id: z.number(),
  name: z.string(),
  originalName: z.string().nullable(),
  gender: z.enum(["female", "male", "other"]).nullable(),
  biography: z.string().nullable(),
  birthday: z.string().nullable(),
  placeOfBirth: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const creditSchema = z.object({
  id: z.string(),
  personId: z.number(),
  personName: z.string(),
  titleId: z.number(),
  seasonId: z.number().nullable(),
  role: z.enum(CREDIT_ROLES),
  character: z.string().nullable(),
  department: z.string().nullable(),
  job: z.string().nullable(),
  sort: z.number(),
});

const personFields = z.object({
  name: nameText,
  originalName: nullableText(200).optional(),
  gender: z.enum(["female", "male", "other"]).nullable().optional(),
  biography: nullableText(10_000).optional(),
  birthday: isoDate.nullable().optional(),
  placeOfBirth: nullableText(200).optional(),
});

const creditFields = z.object({
  personId: z.number().int().positive(),
  seasonId: z.number().int().positive().nullable().optional(),
  role: z.enum(CREDIT_ROLES),
  character: nullableText(200).optional(),
  department: nullableText(100).optional(),
  job: nullableText(100).optional(),
  sort: z.number().int().optional(),
});

export function peopleRoutes() {
  const router = new Hono<AppEnv>();

  router.get(
    "/media/people",
    doc("List people by name", jsonPaged(personSchema)),
    validator("query", z.object({
      q: z.string().trim().min(1).max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })),
    async (c) => {
      const query = c.req.valid("query");
      const { items, total } = await listPeople(c.get("db"), query);
      return c.json({ success: true, data: items, meta: { total, page: query.page, limit: query.limit } });
    },
  );

  router.post("/media/people", doc("Add a person", jsonCreated(personSchema)), validator("json", personFields), async (c) => {
    const row = await createPerson(c.get("db"), c.req.valid("json"));
    await record(c, "media.person.created", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/people/:id", doc("Get a person", jsonOk(personSchema)), validator("param", intParam), async c =>
    c.json({ success: true, data: await getPerson(c.get("db"), c.req.valid("param").id) }));

  router.get(
    "/media/people/:id/credits",
    doc("A person's credits across titles", jsonOk(z.array(creditSchema.omit({ personName: true }).extend({ title: z.string() })))),
    validator("param", intParam),
    async c => c.json({ success: true, data: await personCredits(c.get("db"), c.req.valid("param").id) }),
  );

  router.patch("/media/people/:id", doc("Update a person", jsonOk(personSchema)), validator("param", intParam), validator("json", personFields.partial()), async (c) => {
    const row = await updatePerson(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.person.updated", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/people/:id", doc("Delete a person and their credits", jsonOk(personSchema)), validator("param", intParam), async (c) => {
    const row = await deletePerson(c.get("db"), c.req.valid("param").id);
    await record(c, "media.person.deleted", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get(
    "/media/titles/:id/credits",
    doc("A title's credits; seasonId=none for the title-wide ones, a number for one season's", jsonOk(z.array(creditSchema))),
    validator("param", intParam),
    validator("query", z.object({ seasonId: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional() })),
    async (c) => {
      const { seasonId } = c.req.valid("query");
      const data = await listCredits(c.get("db"), c.req.valid("param").id, seasonId === "none" ? null : seasonId);
      return c.json({ success: true, data });
    },
  );

  router.post("/media/titles/:id/credits", doc("Add a credit", jsonCreated(creditSchema)), validator("param", intParam), validator("json", creditFields), async (c) => {
    const row = await addCredit(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.credit.added", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId, role: row.role });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/credits/reorder", doc("Reorder credits", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderCredits(c.get("db"), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch("/media/credits/:id", doc("Update a credit", jsonOk(creditSchema)), validator("param", idParam), validator("json", creditFields.partial()), async (c) => {
    const row = await updateCredit(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.credit.updated", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/credits/:id", doc("Remove a credit", jsonOk(creditSchema)), validator("param", idParam), async (c) => {
    const row = await deleteCredit(c.get("db"), c.req.valid("param").id);
    await record(c, "media.credit.deleted", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId });
    return c.json({ success: true, data: row });
  });

  return router;
}
