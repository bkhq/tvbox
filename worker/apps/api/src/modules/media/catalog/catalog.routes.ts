import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { jsonCreated, jsonOk, jsonPaged, validator } from "@/shared/lib/openapi";
import { requireMediaDb } from "../db";
import {
  EPISODE_PUBLISH_STATES,
  EPISODE_TYPES,
  PUBLISH_STATES,
  SEASON_STATUSES,
  TITLE_KINDS,
  TITLE_STATUSES,
} from "../schema";
import { doc, idParam, isoDate, nameText, nullableText, record } from "../shared/http";
import { createCollection, deleteCollection, getCollection, listCollections, updateCollection } from "./collections.service";
import {
  createEpisode,
  createSeason,
  deleteEpisode,
  deleteSeason,
  generateEpisodes,
  getEpisode,
  getSeason,
  listEpisodes,
  listSeasons,
  scheduleEpisodes,
  shiftEpisodes,
  updateEpisode,
  updateSeason,
} from "./seasons.service";
import { createTitle, deleteTitle, getTitle, listTitles, updateTitle } from "./titles.service";
import { deleteTranslation, listTranslations, putTranslation } from "./translations.service";

// ─── Schemas ───

const aliasSchema = z.object({
  id: z.string(),
  name: z.string(),
  locale: z.string().nullable(),
  kind: z.enum(["alias", "translation"]),
});

const translationSchema = z.object({
  id: z.string(),
  locale: z.string(),
  title: z.string().nullable(),
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
});

const titleSchema = z.object({
  id: z.string(),
  kind: z.enum(TITLE_KINDS),
  categoryId: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  originCountries: z.array(z.string()),
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
  releaseDate: z.string().nullable(),
  runtime: z.number().nullable(),
  status: z.enum(TITLE_STATUSES),
  statusLocked: z.boolean(),
  contentRating: z.string().nullable(),
  isAdult: z.boolean(),
  voteAverage: z.number().nullable(),
  voteCount: z.number().nullable(),
  popularity: z.number(),
  collectionId: z.string().nullable(),
  publishState: z.enum(PUBLISH_STATES),
  origin: z.string().nullable(),
  sort: z.number(),
  genreIds: z.array(z.string()),
  aliases: z.array(aliasSchema),
  translations: z.array(translationSchema),
  seasonCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const seasonSchema = z.object({
  id: z.string(),
  titleId: z.string(),
  seasonNumber: z.number(),
  name: z.string().nullable(),
  overview: z.string().nullable(),
  airDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.enum(SEASON_STATUSES),
  episodeTotal: z.number().nullable(),
  updateSchedule: z.string().nullable(),
  contentRating: z.string().nullable(),
  publishState: z.enum(PUBLISH_STATES),
  sort: z.number(),
  episodeCount: z.number(),
  publishedEpisodeCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const episodeSchema = z.object({
  id: z.string(),
  seasonId: z.string(),
  episodeNumber: z.number(),
  episodeType: z.enum(EPISODE_TYPES),
  name: z.string().nullable(),
  overview: z.string().nullable(),
  airDate: z.string().nullable(),
  runtime: z.number().nullable(),
  publishState: z.enum(EPISODE_PUBLISH_STATES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  overview: z.string().nullable(),
  titleCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const countSchema = z.object({
  count: z.number(),
});

// ─── Inputs ───

const country = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2");
const language = z.string().regex(/^[a-z]{2,3}$/, "ISO 639-1");

const titleFields = z.object({
  categoryId: z.string().min(1).max(32),
  title: nameText,
  originalTitle: nullableText(200).optional(),
  originalLanguage: language.nullable().optional(),
  originCountries: z.array(country).max(10).optional(),
  overview: nullableText(5000).optional(),
  tagline: nullableText(300).optional(),
  releaseDate: isoDate.nullable().optional(),
  runtime: z.number().int().min(0).max(10_000).nullable().optional(),
  status: z.enum(TITLE_STATUSES).optional(),
  statusLocked: z.boolean().optional(),
  contentRating: nullableText(20).optional(),
  isAdult: z.boolean().optional(),
  voteAverage: z.number().min(0).max(10).nullable().optional(),
  voteCount: z.number().int().min(0).nullable().optional(),
  popularity: z.number().min(0).optional(),
  collectionId: z.string().max(64).nullable().optional(),
  publishState: z.enum(PUBLISH_STATES).optional(),
  origin: nullableText(200).optional(),
  sort: z.number().int().optional(),
  genreIds: z.array(z.string().max(64)).max(20).optional(),
  aliases: z.array(z.object({
    name: nameText,
    locale: z.string().max(10).nullable().optional(),
    kind: z.enum(["alias", "translation"]).optional(),
  })).max(30).optional(),
});

const localeParam = z.object({
  id: z.string().min(1).max(64),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, "BCP 47 like zh-CN"),
});
const translationFields = z.object({
  title: nullableText(200).optional(),
  overview: nullableText(5000).optional(),
  tagline: nullableText(300).optional(),
});

const seasonFields = z.object({
  seasonNumber: z.number().int().min(0).max(1000),
  name: nullableText(100).optional(),
  overview: nullableText(5000).optional(),
  airDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  status: z.enum(SEASON_STATUSES).optional(),
  episodeTotal: z.number().int().min(0).max(10_000).nullable().optional(),
  updateSchedule: nullableText(100).optional(),
  contentRating: nullableText(20).optional(),
  publishState: z.enum(PUBLISH_STATES).optional(),
  sort: z.number().int().optional(),
});

const episodeFields = z.object({
  episodeNumber: z.number().int().min(0).max(100_000),
  episodeType: z.enum(EPISODE_TYPES).optional(),
  name: nullableText(200).optional(),
  overview: nullableText(5000).optional(),
  airDate: isoDate.nullable().optional(),
  runtime: z.number().int().min(0).max(10_000).nullable().optional(),
  publishState: z.enum(EPISODE_PUBLISH_STATES).optional(),
});

const collectionFields = z.object({
  name: nameText,
  overview: nullableText(5000).optional(),
});

export function catalogRoutes() {
  const router = new Hono<AppEnv>();

  // ─── Titles ───

  router.get(
    "/media/titles",
    doc("List titles, newest change first", jsonPaged(titleSchema)),
    validator("query", z.object({
      categoryId: z.string().optional(),
      kind: z.enum(TITLE_KINDS).optional(),
      publishState: z.enum(PUBLISH_STATES).optional(),
      genreId: z.string().optional(),
      collectionId: z.string().optional(),
      q: z.string().trim().min(1).max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })),
    async (c) => {
      const query = c.req.valid("query");
      const { items, total } = await listTitles(requireMediaDb(), query);
      return c.json({
        success: true,
        data: items,
        meta: { total, page: query.page, limit: query.limit },
      });
    },
  );

  router.post("/media/titles", doc("Add a title (a series gets season 1)", jsonCreated(titleSchema)), validator("json", titleFields.extend({
    kind: z.enum(TITLE_KINDS),
  })), async (c) => {
    const row = await createTitle(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.title.created", { type: "media_title", id: row.id, name: row.title }, { kind: row.kind });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/titles/:id", doc("Get a title", jsonOk(titleSchema)), validator("param", idParam), async c =>
    c.json({ success: true, data: await getTitle(requireMediaDb(), c.req.valid("param").id) }));

  router.patch("/media/titles/:id", doc("Update a title", jsonOk(titleSchema)), validator("param", idParam), validator("json", titleFields.partial()), async (c) => {
    const row = await updateTitle(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.title.updated", { type: "media_title", id: row.id, name: row.title }, {
      fields: Object.keys(c.req.valid("json")),
    });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/titles/:id", doc("Delete a title with its seasons, episodes and sources", jsonOk(titleSchema)), validator("param", idParam), async (c) => {
    const row = await deleteTitle(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.title.deleted", { type: "media_title", id: row.id, name: row.title });
    return c.json({ success: true, data: row });
  });

  // ─── Translations ───

  router.get("/media/titles/:id/translations", doc("List a title's translations", jsonOk(z.array(translationSchema))), validator("param", idParam), async (c) => {
    const id = c.req.valid("param").id;
    await getTitle(requireMediaDb(), id);
    return c.json({ success: true, data: await listTranslations(requireMediaDb(), id) });
  });

  router.put("/media/titles/:id/translations/:locale", doc("Set a title's translation for one locale", jsonOk(translationSchema)), validator("param", localeParam), validator("json", translationFields), async (c) => {
    const { id, locale } = c.req.valid("param");
    const row = await putTranslation(requireMediaDb(), id, locale, c.req.valid("json"));
    await record(c, "media.translation.set", { type: "media_title", id, name: locale });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/titles/:id/translations/:locale", doc("Remove a title's translation for one locale", jsonOk(translationSchema)), validator("param", localeParam), async (c) => {
    const { id, locale } = c.req.valid("param");
    const row = await deleteTranslation(requireMediaDb(), id, locale);
    await record(c, "media.translation.deleted", { type: "media_title", id, name: locale });
    return c.json({ success: true, data: row });
  });

  // ─── Seasons ───

  router.get("/media/titles/:id/seasons", doc("List a series' seasons", jsonOk(z.array(seasonSchema))), validator("param", idParam), async (c) => {
    const id = c.req.valid("param").id;
    await getTitle(requireMediaDb(), id);
    return c.json({ success: true, data: await listSeasons(requireMediaDb(), id) });
  });

  router.post("/media/titles/:id/seasons", doc("Add a season", jsonCreated(seasonSchema)), validator("param", idParam), validator("json", seasonFields), async (c) => {
    const row = await createSeason(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.season.created", { type: "media_season", id: row.id, name: `S${row.seasonNumber}` }, { titleId: row.titleId });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/seasons/:id", doc("Get a season", jsonOk(seasonSchema)), validator("param", idParam), async c =>
    c.json({ success: true, data: await getSeason(requireMediaDb(), c.req.valid("param").id) }));

  router.patch("/media/seasons/:id", doc("Update a season", jsonOk(seasonSchema)), validator("param", idParam), validator("json", seasonFields.partial()), async (c) => {
    const row = await updateSeason(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.season.updated", { type: "media_season", id: row.id, name: `S${row.seasonNumber}` }, {
      titleId: row.titleId,
      fields: Object.keys(c.req.valid("json")),
    });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/seasons/:id", doc("Delete a season with its episodes", jsonOk(seasonSchema)), validator("param", idParam), async (c) => {
    const row = await deleteSeason(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.season.deleted", { type: "media_season", id: row.id, name: `S${row.seasonNumber}` }, { titleId: row.titleId });
    return c.json({ success: true, data: row });
  });

  // ─── Episodes ───

  router.get("/media/seasons/:id/episodes", doc("List a season's episodes", jsonOk(z.array(episodeSchema))), validator("param", idParam), async c =>
    c.json({ success: true, data: await listEpisodes(requireMediaDb(), c.req.valid("param").id) }));

  router.post("/media/seasons/:id/episodes", doc("Add an episode", jsonCreated(episodeSchema)), validator("param", idParam), validator("json", episodeFields), async (c) => {
    const row = await createEpisode(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.episode.created", { type: "media_episode", id: row.id, name: `E${row.episodeNumber}` }, { seasonId: row.seasonId });
    return c.json({ success: true, data: row }, 201);
  });

  router.post(
    "/media/seasons/:id/episodes/generate",
    doc("Create episodes from..to, skipping numbers that exist", jsonOk(countSchema)),
    validator("param", idParam),
    validator("json", z.object({
      from: z.number().int().min(0),
      to: z.number().int().min(0),
    })),
    async (c) => {
      const { from, to } = c.req.valid("json");
      const n = await generateEpisodes(requireMediaDb(), c.req.valid("param").id, from, to);
      await record(c, "media.episodes.generated", { type: "media_season", id: c.req.valid("param").id, name: `${from}-${to}` }, { count: n });
      return c.json({
        success: true,
        data: { count: n },
      });
    },
  );

  router.post(
    "/media/seasons/:id/episodes/shift",
    doc("Renumber episodes from a number on by delta", jsonOk(countSchema)),
    validator("param", idParam),
    validator("json", z.object({
      from: z.number().int().min(0),
      delta: z.number().int().min(-1000).max(1000),
    })),
    async (c) => {
      const { from, delta } = c.req.valid("json");
      const n = await shiftEpisodes(requireMediaDb(), c.req.valid("param").id, from, delta);
      await record(c, "media.episodes.shifted", { type: "media_season", id: c.req.valid("param").id, name: `${from}${delta >= 0
        ? "+"
        : ""}${delta}` }, { count: n });
      return c.json({
        success: true,
        data: { count: n },
      });
    },
  );

  router.post(
    "/media/seasons/:id/episodes/schedule",
    doc("Set air dates from a number on: startDate, then every intervalDays", jsonOk(countSchema)),
    validator("param", idParam),
    validator("json", z.object({
      from: z.number().int().min(0),
      startDate: isoDate,
      intervalDays: z.number().int().min(1).max(365),
    })),
    async (c) => {
      const { from, startDate, intervalDays } = c.req.valid("json");
      const n = await scheduleEpisodes(requireMediaDb(), c.req.valid("param").id, from, startDate, intervalDays);
      await record(c, "media.episodes.scheduled", { type: "media_season", id: c.req.valid("param").id, name: startDate }, { count: n, intervalDays });
      return c.json({
        success: true,
        data: { count: n },
      });
    },
  );

  router.get("/media/episodes/:id", doc("Get an episode", jsonOk(episodeSchema)), validator("param", idParam), async c =>
    c.json({ success: true, data: await getEpisode(requireMediaDb(), c.req.valid("param").id) }));

  router.patch("/media/episodes/:id", doc("Update an episode", jsonOk(episodeSchema)), validator("param", idParam), validator("json", episodeFields.partial()), async (c) => {
    const row = await updateEpisode(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.episode.updated", { type: "media_episode", id: row.id, name: `E${row.episodeNumber}` }, {
      seasonId: row.seasonId,
      fields: Object.keys(c.req.valid("json")),
    });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/episodes/:id", doc("Delete an episode", jsonOk(episodeSchema)), validator("param", idParam), async (c) => {
    const row = await deleteEpisode(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.episode.deleted", { type: "media_episode", id: row.id, name: `E${row.episodeNumber}` }, { seasonId: row.seasonId });
    return c.json({ success: true, data: row });
  });

  // ─── Collections ───

  router.get("/media/collections", doc("List collections", jsonOk(z.array(collectionSchema))), async c =>
    c.json({ success: true, data: await listCollections(requireMediaDb()) }));

  router.post("/media/collections", doc("Add a collection", jsonCreated(collectionSchema)), validator("json", collectionFields), async (c) => {
    const row = await createCollection(requireMediaDb(), c.req.valid("json"));
    await record(c, "media.collection.created", { type: "media_collection", id: row.id, name: row.name });
    return c.json({ success: true, data: row }, 201);
  });

  router.get("/media/collections/:id", doc("Get a collection", jsonOk(collectionSchema)), validator("param", idParam), async c =>
    c.json({ success: true, data: await getCollection(requireMediaDb(), c.req.valid("param").id) }));

  router.patch("/media/collections/:id", doc("Update a collection", jsonOk(collectionSchema)), validator("param", idParam), validator("json", collectionFields.partial()), async (c) => {
    const row = await updateCollection(requireMediaDb(), c.req.valid("param").id, c.req.valid("json"));
    await record(c, "media.collection.updated", { type: "media_collection", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  router.delete("/media/collections/:id", doc("Delete a collection (its titles stay)", jsonOk(collectionSchema)), validator("param", idParam), async (c) => {
    const row = await deleteCollection(requireMediaDb(), c.req.valid("param").id);
    await record(c, "media.collection.deleted", { type: "media_collection", id: row.id, name: row.name });
    return c.json({ success: true, data: row });
  });

  return router;
}
