import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, jsonPaged, validator } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import { CREDIT_ROLES } from "../schema";
import { doc, idParam, isoDate, nameText, nullableText, record, reorderBody } from "../shared/http";
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
  id: z.string(),
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
  personId: z.string(),
  personName: z.string(),
  titleId: z.string(),
  seasonId: z.string().nullable(),
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
  personId: z.string().min(1).max(64),
  seasonId: z.string().min(1).max(64).nullable().optional(),
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
      const { items, total } = await listPeople(requireMediaDb(), query);
      return c.json({ success: true, data: items, meta: { total, page: query.page, limit: query.limit } });
    },
  );

  router.post("/media/people", doc("Add a person", jsonCreated(personSchema)), validator("json", personFields), async (c) => {
    const row = await createPerson(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.person.created", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/people/:id", doc("Get a person", jsonOk(personSchema)), validator("param", idParam), async c =>
    c.json({ success: true, data: await getPerson(requireMediaDb(), c.req.valid("param").id) }));

  router.get(
    "/media/people/:id/credits",
    doc("A person's credits across titles", jsonOk(z.array(creditSchema.omit({ personName: true }).extend({ title: z.string() })))),
    validator("param", idParam),
    async c => c.json({ success: true, data: await personCredits(requireMediaDb(), c.req.valid("param").id) }),
  );

  router.patch("/media/people/:id", doc("Update a person", jsonOk(personSchema)), validator("param", idParam), validator("json", personFields.partial()), async (c) => {
    const row = await updatePerson(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.person.updated", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/people/:id", doc("Delete a person and their credits", jsonOk(personSchema)), validator("param", idParam), async (c) => {
    const row = await deletePerson(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.person.deleted", { type: "media_person", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get(
    "/media/titles/:id/credits",
    doc("A title's credits; seasonId=none for the title-wide ones, an id for one season's", jsonOk(z.array(creditSchema))),
    validator("param", idParam),
    validator("query", z.object({ seasonId: z.string().min(1).max(64).optional() })),
    async (c) => {
      const { seasonId } = c.req.valid("query");
      const data = await listCredits(requireMediaDb(), c.req.valid("param").id, seasonId === "none" ? null : seasonId);
      return c.json({ success: true, data });
    },
  );

  router.post("/media/titles/:id/credits", doc("Add a credit", jsonCreated(creditSchema)), validator("param", idParam), validator("json", creditFields), async (c) => {
    const row = await addCredit(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.credit.added", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId, role: row.role });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/credits/reorder", doc("Reorder credits", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderCredits(requireMediaDb(), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch("/media/credits/:id", doc("Update a credit", jsonOk(creditSchema)), validator("param", idParam), validator("json", creditFields.partial()), async (c) => {
    const row = await updateCredit(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.credit.updated", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/credits/:id", doc("Remove a credit", jsonOk(creditSchema)), validator("param", idParam), async (c) => {
    const row = await deleteCredit(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.credit.deleted", { type: "media_credit", id: row.id, name: row.personName }, { titleId: row.titleId });
    return c.json({ success: true, data: row });
  });

  return router;
}
