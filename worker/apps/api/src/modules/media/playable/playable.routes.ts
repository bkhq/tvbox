import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, validator } from "@/shared/lib/openapi";
import { STREAM_FORMATS } from "../schema";
import { doc, httpUrl, idParam, intParam, nameText, nullableText, record, reorderBody } from "../shared/http";
import {
  addStream,
  createSource,
  deleteSource,
  deleteStream,
  listSources,
  listStreams,
  pasteStreams,
  reorderSources,
  updateSource,
  updateStream,
} from "./playable.service";

const sourceSchema = z.object({
  id: z.string(),
  titleId: z.number().nullable(),
  seasonId: z.number().nullable(),
  name: z.string(),
  quality: z.string().nullable(),
  enabled: z.boolean(),
  sort: z.number(),
  streamCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const streamSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  episodeId: z.string().nullable(),
  url: z.string(),
  format: z.enum(STREAM_FORMATS),
  resolution: z.string().nullable(),
  audioLocale: z.string().nullable(),
  userAgent: z.string().nullable(),
  referer: z.string().nullable(),
  sort: z.number(),
});

const pastedLine = z.object({ name: z.string(), url: z.string() });
const pasteResultSchema = z.object({
  matched: z.array(z.object({ episodeId: z.string(), episodeNumber: z.number(), line: pastedLine })),
  missing: z.array(z.object({ episodeNumber: z.number(), line: pastedLine })),
  unmatched: z.array(z.object({ line: pastedLine, reason: z.enum(["no-number", "duplicate", "no-episode"]) })),
  written: z.number(),
  created: z.number(),
});

const sourceFields = z.object({ name: nameText, quality: nullableText(20).optional(), enabled: z.boolean().optional() });

const streamFields = z.object({
  episodeId: z.string().max(64).nullable().optional(),
  url: httpUrl,
  format: z.enum(STREAM_FORMATS).optional(),
  resolution: nullableText(20).optional(),
  audioLocale: z.string().max(10).nullable().optional(),
  userAgent: nullableText(500).optional(),
  referer: httpUrl.nullable().optional(),
  sort: z.number().int().optional(),
});

export function playableRoutes() {
  const router = new Hono<AppEnv>();

  router.get("/media/titles/:id/sources", doc("A movie's sources", jsonOk(z.array(sourceSchema))), validator("param", intParam), async c =>
    c.json({ success: true, data: await listSources(c.get("db"), { titleId: c.req.valid("param").id }) }));

  router.post("/media/titles/:id/sources", doc("Add a source to a movie", jsonCreated(sourceSchema)), validator("param", intParam), validator("json", sourceFields), async (c) => {
    const row = await createSource(c.get("db"), { titleId: c.req.valid("param").id }, c.req.valid("json"));
    await record(c, "media.source.created", { type: "media_source", id: row.id, name: row.name }, { titleId: row.titleId });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/seasons/:id/sources", doc("A season's sources", jsonOk(z.array(sourceSchema))), validator("param", intParam), async c =>
    c.json({ success: true, data: await listSources(c.get("db"), { seasonId: c.req.valid("param").id }) }));

  router.post("/media/seasons/:id/sources", doc("Add a source to a season", jsonCreated(sourceSchema)), validator("param", intParam), validator("json", sourceFields), async (c) => {
    const row = await createSource(c.get("db"), { seasonId: c.req.valid("param").id }, c.req.valid("json"));
    await record(c, "media.source.created", { type: "media_source", id: row.id, name: row.name }, { seasonId: row.seasonId });
    return c.json({ success: true, data: row }, 201);
  });

  router.post("/media/sources/reorder", doc("Reorder sources", jsonOk(z.object({ count: z.number() }))), validator("json", reorderBody), async (c) => {
    const { ids } = c.req.valid("json");
    await reorderSources(c.get("db"), ids);
    return c.json({ success: true, data: { count: ids.length } });
  });

  router.patch("/media/sources/:id", doc("Rename, grade or enable/disable a source", jsonOk(sourceSchema)), validator("param", idParam), validator("json", sourceFields.partial()), async (c) => {
    const row = await updateSource(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.source.updated", { type: "media_source", id: row.id, name: row.name }, c.req.valid("json"));
    return c.json({ success: true, data: row });
  });

  router.delete("/media/sources/:id", doc("Delete a source and its streams", jsonOk(sourceSchema)), validator("param", idParam), async (c) => {
    const row = await deleteSource(c.get("db"), c.req.valid("param").id);
    await record(c, "media.source.deleted", { type: "media_source", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.get("/media/sources/:id/streams", doc("A source's streams", jsonOk(z.array(streamSchema))), validator("param", idParam), async c =>
    c.json({ success: true, data: await listStreams(c.get("db"), c.req.valid("param").id) }));

  router.post("/media/sources/:id/streams", doc("Add a stream", jsonCreated(streamSchema)), validator("param", idParam), validator("json", streamFields), async (c) => {
    const row = await addStream(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.stream.added", { type: "media_stream", id: row.id, name: row.url }, { sourceId: row.sourceId });
    return c.json({ success: true, data: row }, 201);
  });

  router.post(
    "/media/sources/:id/paste",
    doc("Paste name$url lines: lined up with the season's episodes (dryRun previews)", jsonOk(pasteResultSchema)),
    validator("param", idParam),
    validator("json", z.object({ text: z.string().min(1).max(500_000), createMissing: z.boolean().optional(), dryRun: z.boolean().optional() })),
    async (c) => {
      const { text, ...options } = c.req.valid("json");
      const result = await pasteStreams(c.get("db"), c.req.valid("param").id, text, options);
      if (!options.dryRun)
        await record(c, "media.streams.pasted", { type: "media_source", id: c.req.valid("param").id, name: `${result.written} streams` }, { written: result.written, created: result.created });
      return c.json({ success: true, data: result });
    },
  );

  router.patch("/media/streams/:id", doc("Update a stream", jsonOk(streamSchema)), validator("param", idParam), validator("json", streamFields.partial()), async (c) => {
    const row = await updateStream(c.get("db"), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.stream.updated", { type: "media_stream", id: row.id, name: row.url }, { sourceId: row.sourceId });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/streams/:id", doc("Delete a stream", jsonOk(streamSchema)), validator("param", idParam), async (c) => {
    const row = await deleteStream(c.get("db"), c.req.valid("param").id);
    await record(c, "media.stream.deleted", { type: "media_stream", id: row.id, name: row.url }, { sourceId: row.sourceId });
    return c.json({ success: true, data: row });
  });

  return router;
}
