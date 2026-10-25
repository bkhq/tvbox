import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonOk, validator } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import { doc, record } from "../shared/http";
import { importBodySchema, importResultSchema } from "./contract";
import { importTitles } from "./import.service";

export function importRoutes() {
  const router = new Hono<AppEnv>();

  // Titles are written one by one, each in its own batch, so an error
  // part-way leaves the earlier ones in; the call is idempotent, so the
  // caller simply sends the batch again.
  router.post(
    "/media/import",
    doc("Create or update titles in bulk, matched by their tmdb external id", jsonOk(z.object({
      results: z.array(importResultSchema),
    }))),
    validator("json", importBodySchema),
    async (c) => {
      const results = await importTitles(requireMediaDb(), c.req.valid("json").titles);
      const counts = Object.fromEntries([
        "created",
        "updated",
        "unchanged",
        "skipped",
      ].map(a => [a, results.filter(r => r.action === a).length]));
      await record(c, "media.import", { type: "media_import", id: results.length, name: "titles" }, counts);
      return c.json({
        success: true,
        data: { results },
      });
    },
  );

  return router;
}
