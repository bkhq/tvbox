import { z } from "zod";

/**
 * The native Media API v1 (docs/plan/media-library.md, part 2): what
 * `/m/<client token>/v1/*` answers, built per request from the D1 tables
 * (serve/documents.ts).
 *
 * Image urls of uploaded assets are built as `@a/<sha256>/<name>` and
 * rewritten per request to the client's `/m/<token>/a/…`, so the cached
 * documents stay the same for every client. Within v1 fields are only added;
 * clients ignore the ones they do not know.
 */

export const SCHEMA_VERSION = 1;
/** Placeholder for the client's asset prefix, see above. */
export const ASSET_PREFIX = "@a/";

export const imageSchema = z.object({
  url: z.string(),
  w: z.number().nullable(),
  h: z.number().nullable(),
});

export const imagesSchema = z.object({
  poster: imageSchema.nullable().optional(),
  backdrop: imageSchema.nullable().optional(),
  logo: imageSchema.nullable().optional(),
  still: imageSchema.nullable().optional(),
  profile: imageSchema.nullable().optional(),
});

export const cardSchema = z.object({
  id: z.string(),
  type: z.enum(["movie", "series"]),
  category: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  images: imagesSchema,
  /** Shown on the card as it is: 更新至第 8 集, 全 24 集, 1080p, 即将上线. */
  badge: z.string().nullable(),
  rating: z.number().nullable(),
  genres: z.array(z.string()),
});

export const personRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  character: z.string().nullable().optional(),
  job: z.string().nullable().optional(),
  images: imagesSchema.optional(),
});

export const creditsSchema = z.object({
  directors: z.array(personRefSchema),
  writers: z.array(personRefSchema),
  cast: z.array(personRefSchema),
});

export const seasonSummarySchema = z.object({
  id: z.string(),
  number: z.number(),
  name: z.string(),
  status: z.enum(["upcoming", "airing", "ended"]),
  airDate: z.string().nullable(),
  /** Planned episodes when known, else the published ones. */
  episodeCount: z.number(),
  availableCount: z.number(),
  schedule: z.string().nullable(),
  nextAirDate: z.string().nullable(),
  images: imagesSchema,
});

export const titleDetailSchema = cardSchema.extend({
  originalTitle: z.string().nullable(),
  aliases: z.array(z.string()),
  overview: z.string().nullable(),
  tagline: z.string().nullable(),
  status: z.enum([
    "upcoming",
    "released",
    "returning",
    "ended",
    "canceled",
  ]),
  contentRating: z.string().nullable(),
  isAdult: z.boolean(),
  countries: z.array(z.string()),
  language: z.string().nullable(),
  releaseDate: z.string().nullable(),
  runtime: z.number().nullable(),
  voteCount: z.number().nullable(),
  credits: creditsSchema,
  collection: z.object({
    id: z.string(),
    name: z.string(),
  }).nullable(),
  externalIds: z.record(z.string(), z.string()),
  /** Title, overview and tagline per locale (`zh-CN`, `en-US`, …) where known. */
  translations: z.record(z.string(), z.object({
    title: z.string().nullable(),
    overview: z.string().nullable(),
    tagline: z.string().nullable(),
  })),
  seasons: z.array(seasonSummarySchema),
  /** The season a client opens first: the newest with something to play. */
  defaultSeason: z.string().nullable(),
  /** Movies: whether there is anything to play (`/playback/<id>`). */
  available: z.boolean(),
  updatedAt: z.string(),
});

export const episodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  type: z.enum([
    "standard",
    "premiere",
    "finale",
    "special",
  ]),
  name: z.string(),
  overview: z.string().nullable(),
  airDate: z.string().nullable(),
  runtime: z.number().nullable(),
  images: imagesSchema,
  available: z.boolean(),
});

export const seasonDetailSchema = seasonSummarySchema.extend({
  titleId: z.string(),
  title: z.string(),
  overview: z.string().nullable(),
  endDate: z.string().nullable(),
  contentRating: z.string().nullable(),
  credits: creditsSchema,
  episodes: z.array(episodeSchema),
});

export const streamSchema = z.object({
  url: z.string(),
  format: z.enum(["hls", "mp4", "dash"]),
  resolution: z.string().nullable(),
  audio: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
});

export const playbackSchema = z.object({
  id: z.string(),
  titleId: z.string(),
  seasonId: z.string().nullable(),
  episode: z.object({
    number: z.number(),
    name: z.string(),
  }).nullable(),
  sources: z.array(z.object({
    id: z.string(),
    name: z.string(),
    quality: z.string().nullable(),
    streams: z.array(streamSchema),
  })),
  next: z.object({
    id: z.string(),
    seasonId: z.string(),
    number: z.number(),
  }).nullable(),
  // Reserved; empty in this version.
  subtitles: z.array(z.unknown()),
  markers: z.unknown().nullable(),
  expiresAt: z.string().nullable(),
});

export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalName: z.string().nullable(),
  gender: z.enum(["female", "male", "other"]).nullable(),
  biography: z.string().nullable(),
  birthday: z.string().nullable(),
  placeOfBirth: z.string().nullable(),
  images: imagesSchema,
  credits: z.array(z.object({
    title: cardSchema,
    role: z.enum(["cast", "crew"]),
    character: z.string().nullable(),
    job: z.string().nullable(),
  })),
});

export const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  overview: z.string().nullable(),
  images: imagesSchema,
  titles: z.array(cardSchema),
});

export const pageSchema = z.object({
  items: z.array(cardSchema),
  /** Pass back as `cursor` for the next page; null at the end. */
  cursor: z.string().nullable(),
});

export const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(cardSchema),
  cursor: z.string().nullable(),
});

export const homeSchema = z.object({
  hero: z.array(cardSchema.extend({
    overview: z.string().nullable(),
    tagline: z.string().nullable(),
  })),
  rows: z.array(rowSchema),
});

export const facetValueSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
});
export const facetsSchema = z.object({
  genre: z.array(facetValueSchema).optional(),
  year: z.array(facetValueSchema).optional(),
  country: z.array(facetValueSchema).optional(),
});

export const searchSchema = z.object({
  titles: z.array(cardSchema),
  people: z.array(personRefSchema),
  cursor: z.string().nullable(),
});

export const manifestSchema = z.object({
  schemaVersion: z.number(),
  generation: z.string(),
  categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kinds: z.array(z.enum(["movie", "series"])),
    filters: z.array(z.enum(["genre", "year", "country"])),
    count: z.number(),
  })),
  genres: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })),
  countries: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })),
  languages: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })),
  rows: z.array(z.string()),
  capabilities: z.object({
    live: z.boolean(),
  }),
});

export const liveSchema = z.object({
  epg: z.array(z.string()),
  groups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    channels: z.array(z.object({
      id: z.string(),
      number: z.number().nullable(),
      name: z.string(),
      tvgId: z.string().nullable(),
      logo: z.string().nullable(),
      streams: z.array(z.object({
        url: z.string(),
        label: z.string().nullable(),
        headers: z.record(z.string(), z.string()),
      })),
    })),
  })),
});

export type Image = z.infer<typeof imageSchema>;
export type Images = z.infer<typeof imagesSchema>;
export type Card = z.infer<typeof cardSchema>;
export type PersonRef = z.infer<typeof personRefSchema>;
export type Credits = z.infer<typeof creditsSchema>;
export type SeasonSummary = z.infer<typeof seasonSummarySchema>;
export type TitleDetail = z.infer<typeof titleDetailSchema>;
export type Episode = z.infer<typeof episodeSchema>;
export type SeasonDetail = z.infer<typeof seasonDetailSchema>;
export type Playback = z.infer<typeof playbackSchema>;
export type Person = z.infer<typeof personSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type Home = z.infer<typeof homeSchema>;
export type Facets = z.infer<typeof facetsSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Live = z.infer<typeof liveSchema>;
