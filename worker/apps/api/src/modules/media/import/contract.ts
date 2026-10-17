import { z } from "zod";

/**
 * What an importer (scripts/media-import-tmdb.ts) sends for one title:
 * the title with everything that hangs off it, keyed by external ids so a
 * second run updates instead of duplicating. Kept free of app imports so
 * the script can load it.
 */

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const httpUrl = z.string().max(2000).url();
const locale = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, "BCP 47 like zh-CN");

export const importImageSchema = z.object({
  kind: z.enum(["poster", "backdrop", "logo"]),
  url: httpUrl,
  locale: locale.nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

export const importPersonSchema = z.object({
  externalId: text(64).min(1),
  name: text(200).min(1),
  originalName: nullableText(200).optional(),
  profile: httpUrl.nullable().optional(),
});

export const importCreditSchema = z.object({
  person: importPersonSchema,
  role: z.enum(["cast", "crew"]),
  character: nullableText(200).optional(),
  department: nullableText(100).optional(),
  job: nullableText(100).optional(),
});

export const importSeasonSchema = z.object({
  number: z.number().int().min(0).max(1000),
  name: nullableText(100).optional(),
  overview: nullableText(5000).optional(),
  airDate: isoDate.nullable().optional(),
  episodeTotal: z.number().int().min(0).max(10_000).nullable().optional(),
  poster: httpUrl.nullable().optional(),
});

export const importTitleSchema = z.object({
  kind: z.enum(["movie", "series"]),
  /** At least `tmdb`; its value is `movie:<id>` or `tv:<id>` (TMDB's id spaces overlap). */
  externalIds: z.object({ tmdb: text(64).min(1), imdb: text(64).optional(), tvdb: text(64).optional(), douban: text(64).optional() }),
  categoryId: text(32).min(1),
  title: text(200).min(1),
  originalTitle: nullableText(200).optional(),
  originalLanguage: z.string().regex(/^[a-z]{2,3}$/).nullable().optional(),
  originCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).optional(),
  overview: nullableText(5000).optional(),
  tagline: nullableText(300).optional(),
  releaseDate: isoDate.nullable().optional(),
  runtime: z.number().int().min(0).max(10_000).nullable().optional(),
  status: z.enum(["upcoming", "released", "returning", "ended", "canceled"]).optional(),
  contentRating: nullableText(20).optional(),
  isAdult: z.boolean().optional(),
  voteAverage: z.number().min(0).max(10).nullable().optional(),
  voteCount: z.number().int().min(0).nullable().optional(),
  popularity: z.number().min(0).optional(),
  publishState: z.enum(["draft", "published", "hidden"]).optional(),
  origin: text(200).min(1).optional(),
  sort: z.number().int().optional(),
  genreIds: z.array(text(64)).max(20).optional(),
  translations: z.array(z.object({ locale, title: nullableText(200).optional(), overview: nullableText(5000).optional(), tagline: nullableText(300).optional() })).max(50).optional(),
  images: z.array(importImageSchema).max(20).optional(),
  collection: z.object({ externalId: text(64).min(1), name: text(200).min(1), overview: nullableText(5000).optional() }).nullable().optional(),
  seasons: z.array(importSeasonSchema).max(200).optional(),
  credits: z.array(importCreditSchema).max(100).optional(),
});

export const importBodySchema = z.object({ titles: z.array(importTitleSchema).min(1).max(50) });

export const importResultSchema = z.object({
  externalId: z.string(),
  id: z.string().nullable(),
  action: z.enum(["created", "updated", "unchanged", "skipped"]),
});

export type ImportTitle = z.infer<typeof importTitleSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
