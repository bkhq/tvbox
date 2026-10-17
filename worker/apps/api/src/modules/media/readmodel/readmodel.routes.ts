import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "@/shared/lib/errors";
import { jsonOk } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import { doc, record } from "../shared/http";
import { projectLibrary } from "./projector.service";
import { getReadModelDb } from "./store";

const resultSchema = z.object({ generation: z.string(), upserted: z.number(), deleted: z.number(), titles: z.number() });

export function readModelRoutes() {
  const router = new Hono<AppEnv>();

  // Publishing updates the read model incrementally; this rewrites it whole,
  // after a schema change or to repair it.
  router.post("/media/readmodel/rebuild", doc("Rebuild the published read model from scratch", jsonOk(resultSchema)), async (c) => {
    const rm = getReadModelDb();
    if (!rm)
      throw new AppError("This deployment has no media read model", 409, "READ_MODEL_UNAVAILABLE");
    const result = await projectLibrary(requireMediaDb(), rm, { full: true });
    await record(c, "media.readmodel.rebuilt", { type: "media_readmodel", id: result.generation, name: "read model" }, { titles: result.titles });
    return c.json({ success: true, data: result });
  });

  return router;
}
