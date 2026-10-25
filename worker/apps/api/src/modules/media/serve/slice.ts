import type { SQLWrapper } from "drizzle-orm";
import type { MediaDb } from "../db";
import type { Slice } from "./documents";
import { and, eq, inArray, or } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import {
  mediaCategories,
  mediaCollections,
  mediaCredits,
  mediaEpisodes,
  mediaExternalIds,
  mediaGenres,
  mediaImages,
  mediaPeople,
  mediaPublished,
  mediaSeasons,
  mediaSources,
  mediaStreams,
  mediaTitleAliases,
  mediaTitleGenres,
  mediaTitles,
  mediaTitleTranslations,
} from "../schema";

// The image query binds the ids three times; D1 allows 100 parameters.
const CHUNK = 30;

function liveIds(db: MediaDb, kind: "title" | "season" | "episode") {
  return db.select({ id: mediaPublished.id }).from(mediaPublished).where(eq(mediaPublished.kind, kind));
}

/** The live rows of `ids` and what hangs off them, a few queries per 30 titles; people only with `credits`. */
export async function loadSlice(db: MediaDb, titleIds: readonly string[], options: { credits?: boolean } = {}): Promise<Slice> {
  const [categories, genres] = await db.batch([
    db.select().from(mediaCategories),
    db.select().from(mediaGenres),
  ]);
  const parts = await Promise.all(chunked([
    ...new Set(titleIds),
  ], CHUNK).map(ids => loadPart(db, ids, options.credits ?? false)));
  const all = <K extends keyof Omit<Slice, "categories" | "genres">>(key: K): Slice[K] => parts.flatMap(p => p[key] as unknown[]) as unknown as Slice[K];
  return {
    categories,
    genres,
    collections: [
      ...new Map(all("collections").map(c => [c.id, c])).values(),
    ],
    titles: all("titles"),
    aliases: all("aliases"),
    translations: all("translations"),
    titleGenres: all("titleGenres"),
    seasons: all("seasons"),
    episodes: all("episodes"),
    people: [
      ...new Map(all("people").map(p => [p.id, p])).values(),
    ],
    credits: all("credits"),
    images: [
      ...new Map(all("images").map(i => [i.id, i])).values(),
    ],
    externalIds: all("externalIds"),
    sources: all("sources"),
    streams: all("streams"),
  };
}

async function loadPart(db: MediaDb, ids: string[], withCredits: boolean): Promise<Omit<Slice, "categories" | "genres">> {
  const seasonIds = db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(inArray(mediaSeasons.titleId, ids));
  const sourceIds = db.select({ id: mediaSources.id }).from(mediaSources).where(or(inArray(mediaSources.titleId, ids), inArray(mediaSources.seasonId, seasonIds)));
  const personIds = db.select({ id: mediaCredits.personId }).from(mediaCredits).where(inArray(mediaCredits.titleId, ids));
  const owned = (type: "title" | "season" | "episode" | "person", owner: string[] | SQLWrapper) =>
    and(eq(mediaImages.ownerType, type), inArray(mediaImages.ownerId, owner));

  const [titles, aliases, translations, titleGenres, externalIds, seasons, episodes, sources, streams, images, collections] = await db.batch([
    db.select().from(mediaTitles).where(and(inArray(mediaTitles.id, ids), inArray(mediaTitles.id, liveIds(db, "title")))),
    db.select().from(mediaTitleAliases).where(inArray(mediaTitleAliases.titleId, ids)),
    db.select().from(mediaTitleTranslations).where(inArray(mediaTitleTranslations.titleId, ids)),
    db.select({ titleId: mediaTitleGenres.titleId, genreId: mediaTitleGenres.genreId }).from(mediaTitleGenres).where(inArray(mediaTitleGenres.titleId, ids)),
    db.select().from(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, "title"), inArray(mediaExternalIds.ownerId, ids))),
    db.select().from(mediaSeasons).where(and(inArray(mediaSeasons.titleId, ids), inArray(mediaSeasons.id, liveIds(db, "season")))),
    db.select().from(mediaEpisodes).where(and(inArray(mediaEpisodes.seasonId, seasonIds), inArray(mediaEpisodes.id, liveIds(db, "episode")))),
    db.select().from(mediaSources).where(inArray(mediaSources.id, sourceIds)),
    db.select().from(mediaStreams).where(inArray(mediaStreams.sourceId, sourceIds)),
    db.select().from(mediaImages).where(or(
      owned("title", ids),
      owned("season", seasonIds),
      owned("episode", db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(inArray(mediaEpisodes.seasonId, seasonIds))),
    )),
    db.select().from(mediaCollections).where(inArray(mediaCollections.id, db.select({ id: mediaTitles.collectionId }).from(mediaTitles).where(inArray(mediaTitles.id, ids)))),
  ]);
  if (!withCredits) {
    return {
      titles,
      aliases,
      translations,
      titleGenres,
      externalIds,
      seasons,
      episodes,
      sources,
      streams,
      images,
      collections,
      credits: [],
      people: [],
    };
  }

  const [credits, people, profiles] = await db.batch([
    db.select().from(mediaCredits).where(inArray(mediaCredits.titleId, ids)),
    db.select().from(mediaPeople).where(inArray(mediaPeople.id, personIds)),
    db.select().from(mediaImages).where(owned("person", personIds)),
  ]);
  return {
    titles,
    aliases,
    translations,
    titleGenres,
    externalIds,
    seasons,
    episodes,
    sources,
    streams,
    images: [
      ...images,
      ...profiles,
    ],
    collections,
    credits,
    people,
  };
}
