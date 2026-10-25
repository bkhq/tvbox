import type { MiddlewareHandler } from "hono";
import type { ZodType } from "zod";
import type { BrowseSort } from "./query";
import type { MediaDb } from "@/modules/media/db";
import { and, eq, inArray } from "drizzle-orm";
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
import { loadLive } from "@/modules/media/live/live.service";
import { mediaImages, mediaRows } from "@/modules/media/schema";
import { imagePicker } from "@/modules/media/serve/documents";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, resolver, validator } from "@/shared/lib/openapi";
import {
  BROWSE_SORTS,
  browseIds,
  cards,
  collection,
  facets,
  home,
  manifest,
  person,
  playback,
  rowTitleIds,
  searchPeople,
  searchTitleIds,
  seasonDetail,
  titleDetail,
} from "./query";

/**
 * The native Media API v1, answered from the source tables (./query.ts); the
 * caller (`handleMedia`) adds caching and rewrites asset urls.
 */

export interface MediaBindings {
  readonly db: MediaDb;
  readonly generation: string;
  /** The day episodes and releases are gated by (UTC). */
  readonly today: string;
}

interface Env { Bindings: MediaBindings }

const TAG = "Media v1";
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

function doc(summary: string, schema: ZodType, ...errors: number[]): MiddlewareHandler {
  return describeRoute({
    tags: [TAG],
    summary,
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: resolver(schema),
          },
        },
      },
      ...Object.fromEntries(errors.map(code => [
        code,
        {
          description: "Error",
          content: {
            "application/json": {
              schema: resolver(errorSchema),
            },
          },
        },
      ])),
    },
  });
}

function json(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const limit = (max: number, fallback: number) => z.coerce.number().int().min(1).max(max).default(fallback);
const offsetCursor = z.string().regex(/^\d{1,6}$/).optional();
const idParam = z.object({
  id: z.string().min(1).max(64),
});

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

const facetsQuery = browseQuery.pick({
  category: true,
  type: true,
  genre: true,
  year: true,
  country: true,
});

export function mediaV1(): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((err) => {
    const status = err instanceof AppError
      ? err.statusCode
      : 500;
    const code = err instanceof AppError
      ? err.code
      : "INTERNAL_ERROR";
    const message = err instanceof AppError
      ? err.message
      : "Internal error";
    return json(JSON.stringify({
      error: { code, message },
    }), status);
  });
  app.notFound(() => json(JSON.stringify({
    error: { code: "NOT_FOUND", message: "Not found" },
  }), 404));

  app.get("/manifest", doc("Dictionaries, rows and capabilities; `generation` changes with every publish", manifestSchema), async (c) => {
    return c.json({
      ...await manifest(c.env.db),
      generation: c.env.generation,
    });
  });

  app.get("/home", doc("Hero and the home rows with their first cards", homeSchema), async (c) => {
    return c.json(await home(c.env.db, c.env.today));
  });

  app.get(
    "/rows/:id",
    doc("More cards of a row", rowSchema, 404),
    validator("param", idParam),
    validator("query", z.object({
      cursor: offsetCursor,
      limit: limit(50, 20),
    })),
    async (c) => {
      const { id } = c.req.valid("param");
      const { cursor, limit } = c.req.valid("query");
      const row = await c.env.db.select().from(mediaRows).where(eq(mediaRows.id, id)).get();
      if (!row)
        throw new NotFoundError("Row", id);
      const offset = Number(cursor ?? 0);
      const ids = await rowTitleIds(c.env.db, row, offset, limit + 1);
      return c.json({
        id,
        name: row.name,
        items: await cards(c.env.db, ids.slice(0, limit), c.env.today),
        cursor: ids.length > limit
          ? String(offset + limit)
          : null,
      });
    },
  );

  app.get("/browse", doc("Cards by category and filters, a page at a time", pageSchema, 422), validator("query", browseQuery), async (c) => {
    const q = c.req.valid("query");
    const page = await browseIds(c.env.db, q, q.sort as BrowseSort, q.limit, q.cursor);
    return c.json({ items: await cards(c.env.db, page.ids, c.env.today), cursor: page.cursor });
  });

  app.get("/facets", doc("The values each filter can still take, with counts", facetsSchema, 422), validator("query", facetsQuery), async (c) => {
    return c.json(await facets(c.env.db, c.req.valid("query")));
  });

  app.get(
    "/search",
    doc("Titles and people by name", searchSchema, 422),
    validator("query", z.object({
      q: z.string().trim().min(1).max(50),
      cursor: offsetCursor,
      limit: limit(50, 20),
    })),
    async (c) => {
      const { q, cursor, limit } = c.req.valid("query");
      const offset = Number(cursor ?? 0);
      const [titleIds, people] = await Promise.all([
        searchTitleIds(c.env.db, q, offset, limit + 1),
        searchPeople(c.env.db, q, offset, limit + 1),
      ]);
      const shown = people.slice(0, limit);
      const profiles = shown.length === 0
        ? []
        : await c.env.db.select().from(mediaImages).where(and(eq(mediaImages.ownerType, "person"), inArray(mediaImages.ownerId, shown.map(p => p.id)))).all();
      const { image } = imagePicker(profiles);
      return c.json({
        titles: await cards(c.env.db, titleIds.slice(0, limit), c.env.today),
        people: shown.map(p => ({
          id: p.id,
          name: p.name,
          images: {
            profile: image("person", p.id, "profile"),
          },
        })),
        cursor: titleIds.length > limit || people.length > limit
          ? String(offset + limit)
          : null,
      });
    },
  );

  const byId = (path: string, summary: string, schema: ZodType, load: (env: MediaBindings, id: string) => Promise<unknown>, what: string) =>
    app.get(path, doc(summary, schema, 404), validator("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const found = await load(c.env, id);
      if (!found)
        throw new NotFoundError(what, id);
      return c.json(found);
    });

  byId("/titles/:id", "A title with its seasons, credits and images", titleDetailSchema, (env, id) => titleDetail(env.db, id, env.today), "Title");
  byId("/seasons/:id", "A season and all its episodes", seasonDetailSchema, (env, id) => seasonDetail(env.db, id, env.today), "Season");
  byId("/people/:id", "A person and the titles they are credited in", personSchema, (env, id) => person(env.db, id, env.today), "Person");
  byId("/collections/:id", "A collection's titles, oldest first", collectionSchema, (env, id) => collection(env.db, id, env.today), "Collection");
  byId("/playback/:id", "What a movie (by title id) or an episode (by episode id) plays; never cached", playbackSchema, (env, id) => playback(env.db, id, env.today), "Playback");

  app.get("/live/channels", doc("Live channel groups, channels and their streams", liveSchema), async (c) => {
    return c.json(await loadLive(c.env.db));
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
        tags: [
          { name: TAG },
        ],
      },
    });
    return spec(c, next);
  });

  return app;
}
