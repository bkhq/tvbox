import type { MiddlewareHandler } from "hono";
import type { ZodType } from "zod";
import type { BrowseSort } from "./query";
import type { ReadModelDb } from "@/modules/media/readmodel/store";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { z } from "zod";
import {
  collectionSchema,
  facetsSchema,
  homeSchema,
  liveSchema,
  manifestSchema,
  pageSchema,
  personSchema,
  playbackSchema,
  rowSchema,
  SCHEMA_VERSION,
  searchSchema,
  seasonDetailSchema,
  titleDetailSchema,
} from "@/modules/media/contract";
import { countryName } from "@/modules/media/readmodel/names";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, resolver, validator } from "@/shared/lib/openapi";
import { browse, BROWSE_SORTS, document, documentsByIds, facetCounts, meta, rowPage, searchRefs } from "./query";

/**
 * The native Media API v1, answered from the read model. Handlers return the
 * stored documents as they are, spliced into the response as strings; the
 * caller (`handleMedia`) adds caching and rewrites asset urls.
 */

export interface MediaBindings {
  readonly rm: ReadModelDb;
  readonly generation: string;
}

interface Env { Bindings: MediaBindings }

const TAG = "Media v1";
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

function doc(summary: string, schema: ZodType, ...errors: number[]): MiddlewareHandler {
  return describeRoute({
    tags: [TAG],
    summary,
    responses: {
      200: { description: "OK", content: { "application/json": { schema: resolver(schema) } } },
      ...Object.fromEntries(errors.map(code => [code, { description: "Error", content: { "application/json": { schema: resolver(errorSchema) } } }])),
    },
  });
}

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const list = (docs: readonly string[]) => `[${docs.join(",")}]`;

/** `t123` → 123 for a prefix `t`; anything else is not found. */
function numericId(prefix: string, id: string, what: string): number {
  const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new NotFoundError(what, id);
  return n;
}

const limit = (max: number, fallback: number) => z.coerce.number().int().min(1).max(max).default(fallback);
const offsetCursor = z.string().regex(/^\d{1,6}$/).optional();
const idParam = z.object({ id: z.string().min(1).max(64) });

const browseQuery = z.object({
  category: z.string().max(32).optional(),
  type: z.enum(["movie", "series"]).optional(),
  genre: z.string().max(64).optional(),
  year: z.coerce.number().int().min(1800).max(3000).optional(),
  country: z.string().max(8).optional(),
  sort: z.enum(BROWSE_SORTS).default("updated"),
  limit: limit(50, 24),
  cursor: z.string().max(200).optional(),
});

const facetsQuery = browseQuery.pick({ category: true, type: true, genre: true, year: true, country: true });

export function mediaV1(): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((err) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
    const message = err instanceof AppError ? err.message : "Internal error";
    return json(JSON.stringify({ error: { code, message } }), status);
  });
  app.notFound(() => json(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), 404));

  app.get("/manifest", doc("Dictionaries, rows and capabilities; `generation` changes with every publish", manifestSchema), async (c) => {
    const stored = await meta<Record<string, unknown>>(c.env.rm, "manifest");
    return c.json({ ...stored, schemaVersion: SCHEMA_VERSION, generation: c.env.generation });
  });

  app.get("/home", doc("Hero and the home rows with their first cards", homeSchema), async (c) => {
    return json(JSON.stringify(await meta(c.env.rm, "home") ?? { hero: [], rows: [] }));
  });

  app.get(
    "/rows/:id",
    doc("More cards of a row", rowSchema, 404),
    validator("param", idParam),
    validator("query", z.object({ cursor: offsetCursor, limit: limit(50, 20) })),
    async (c) => {
      const { id } = c.req.valid("param");
      const { cursor, limit } = c.req.valid("query");
      const page = await rowPage(c.env.rm, id, Number(cursor ?? 0), limit);
      if (!page)
        throw new NotFoundError("Row", id);
      return json(`{"id":${JSON.stringify(id)},"name":${JSON.stringify(page.name)},"items":${list(page.cards)},"cursor":${JSON.stringify(page.cursor)}}`);
    },
  );

  app.get("/browse", doc("Cards by category and filters, a page at a time", pageSchema, 422), validator("query", browseQuery), async (c) => {
    const q = c.req.valid("query");
    const page = await browse(c.env.rm, q, q.sort as BrowseSort, q.limit, q.cursor);
    return json(`{"items":${list(page.cards)},"cursor":${JSON.stringify(page.cursor)}}`);
  });

  app.get("/facets", doc("The values each filter can still take, with counts", facetsSchema, 422), validator("query", facetsQuery), async (c) => {
    const q = c.req.valid("query");
    const narrowed = q.type || q.genre || q.year !== undefined || q.country;
    if (q.category && !narrowed) {
      const stored = await meta(c.env.rm, `facets:${q.category}`);
      if (stored)
        return json(JSON.stringify(stored));
    }
    const counts = await facetCounts(c.env.rm, q);
    const genres = (await meta<{ genres: { id: string; name: string }[] }>(c.env.rm, "manifest"))?.genres ?? [];
    const genreName = new Map(genres.map(g => [g.id, g.name]));
    return c.json({
      genre: counts.genre.map(([value, count]) => ({ value, label: genreName.get(value) ?? value, count })),
      year: counts.year.map(([value, count]) => ({ value, label: value, count })),
      country: counts.country.map(([value, count]) => ({ value, label: countryName(value), count })),
    });
  });

  app.get(
    "/search",
    doc("Titles and people by name", searchSchema, 422),
    validator("query", z.object({ q: z.string().trim().min(1).max(50), cursor: offsetCursor, limit: limit(50, 20) })),
    async (c) => {
      const { q, cursor, limit } = c.req.valid("query");
      const offset = Number(cursor ?? 0);
      const refs = await searchRefs(c.env.rm, q, offset, limit + 1);
      const page = refs.slice(0, limit);
      const ids = (prefix: string) => page.filter(r => r.startsWith(prefix)).map(r => Number(r.slice(1)));
      const titles = await documentsByIds(c.env.rm, "titles", ids("t"), "card_json");
      const people = (await documentsByIds(c.env.rm, "people", ids("p"), "json")).map((raw) => {
        const p = JSON.parse(raw) as z.infer<typeof personSchema>;
        return { id: p.id, name: p.name, images: p.images };
      });
      return json(`{"titles":${list(titles)},"people":${JSON.stringify(people)},"cursor":${JSON.stringify(refs.length > limit ? String(offset + limit) : null)}}`);
    },
  );

  const byId = (path: string, summary: string, schema: ZodType, load: (rm: ReadModelDb, id: string) => Promise<string | null>, what: string) =>
    app.get(path, doc(summary, schema, 404), validator("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const found = await load(c.env.rm, id);
      if (!found)
        throw new NotFoundError(what, id);
      return json(found);
    });

  byId("/titles/:id", "A title with its seasons, credits and images", titleDetailSchema, (rm, id) => document(rm, "titles", numericId("t", id, "Title")), "Title");
  byId("/seasons/:id", "A season and all its episodes", seasonDetailSchema, (rm, id) => document(rm, "seasons", numericId("s", id, "Season")), "Season");
  byId("/people/:id", "A person and the titles they are credited in", personSchema, (rm, id) => document(rm, "people", numericId("p", id, "Person")), "Person");
  byId("/collections/:id", "A collection's titles, oldest first", collectionSchema, (rm, id) => document(rm, "collections", id.startsWith("c") ? id.slice(1) : ""), "Collection");
  byId("/playback/:id", "What a movie (`t…`) or an episode (`e…`) plays; never cached", playbackSchema, (rm, id) => document(rm, "playback", id), "Playback");

  app.get("/live/channels", doc("Live channel groups, channels and their streams", liveSchema), async (c) => {
    return json(JSON.stringify(await meta(c.env.rm, "live") ?? { epg: [], groups: [] }));
  });

  let spec: MiddlewareHandler | undefined;
  app.get("/openapi.json", (c, next) => {
    spec ??= openAPIRouteHandler(app, {
      documentation: {
        openapi: "3.1.0",
        info: {
          title: "TVBox Media API",
          version: String(SCHEMA_VERSION),
          description: "Served under `/s/<token>/media/v1`. Errors are `{\"error\": {\"code\", \"message\"}}`.",
        },
        tags: [{ name: TAG }],
      },
    });
    return spec(c, next);
  });

  return app;
}
