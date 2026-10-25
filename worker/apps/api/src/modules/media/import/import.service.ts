import type { MediaDb, Statement } from "../db";
import type { ImportResult, ImportTitle } from "./contract";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, isUniqueViolation } from "@/shared/lib/errors";
import { mediaId, ulid } from "@/shared/lib/id";
import { assertCategoryAccepts, assertGenres, refreshSeriesStatus } from "../catalog/titles.service";
import { replaceTranslations } from "../catalog/translations.service";
import { insertRows, runBatch } from "../db";
import {
  mediaCollections,
  mediaCredits,
  mediaExternalIds,
  mediaImages,
  mediaPeople,
  mediaSeasons,
  mediaTitleGenres,
  mediaTitles,
  mediaTitleTranslations,
} from "../schema";

/**
 * Bulk upsert for importers. A title is found by its `tmdb` external id:
 * missing → created with everything attached; present with the importer's
 * `origin` → brought up to date (category and publish state are the
 * console's and kept); present with another origin → left alone. Nothing is
 * written, and `updatedAt` stays, when the data is already there.
 *
 * Each title is one read batch and one write batch, so a title either lands
 * whole or not at all.
 */

type TitleRow = typeof mediaTitles.$inferSelect;
type SeasonRow = typeof mediaSeasons.$inferSelect;
type ExternalSource = typeof mediaExternalIds.$inferSelect["source"];

const DEFAULT_ORIGIN = "tmdb";
const DEFAULT_PUBLISH_STATE = "published";

/** The part of a title the importer owns, in one comparable shape. */
interface Managed {
  readonly title: string;
  readonly originalTitle: string | null;
  readonly originalLanguage: string | null;
  readonly originCountries: string[];
  readonly overview: string | null;
  readonly tagline: string | null;
  readonly releaseDate: string | null;
  readonly runtime: number | null;
  readonly status: TitleRow["status"];
  readonly contentRating: string | null;
  readonly isAdult: boolean;
  readonly voteAverage: number | null;
  readonly voteCount: number | null;
  readonly popularity: number;
  readonly sort: number;
  readonly collectionId: string | null;
  readonly genreIds: string[];
  readonly translations: { locale: string; title: string | null; overview: string | null; tagline: string | null }[];
  readonly externalIds: [ExternalSource, string][];
  /** Image URLs that have to exist. */
  readonly images: string[];
  readonly seasons: { number: number; name: string | null; overview: string | null; airDate: string | null; episodeTotal: number | null; status: "upcoming" | "airing" | "ended"; poster: string | null }[];
  readonly credits: { person: string; role: "cast" | "crew"; character: string | null; department: string | null; job: string | null }[];
}

/** What an existing title has now, read in one batch. */
interface Stored {
  readonly genres: { id: string }[];
  readonly translations: { locale: string; title: string | null; overview: string | null; tagline: string | null }[];
  readonly externals: { source: ExternalSource; externalId: string }[];
  readonly images: { url: string | null; kind: string; sort: number }[];
  readonly seasons: SeasonRow[];
  readonly seasonImages: { ownerId: string; url: string | null; kind: string; sort: number }[];
  readonly credits: { role: "cast" | "crew"; character: string | null; department: string | null; job: string | null; person: string | null }[];
}

const collectionIdOf = (externalId: string) => `tmdb-c${externalId}`;

function seasonStatus(item: ImportTitle, season: NonNullable<ImportTitle["seasons"]>[number], today: string): "upcoming" | "airing" | "ended" {
  if (!season.airDate || season.airDate > today)
    return "upcoming";
  if (item.status === "ended" || item.status === "canceled")
    return "ended";
  const later = (item.seasons ?? []).some(s => s.number > season.number && s.airDate && s.airDate <= today);
  return later ? "ended" : "airing";
}

function wanted(item: ImportTitle, today: string): Managed {
  const sources = ["tmdb", "imdb", "tvdb", "douban"] as const;
  return {
    title: item.title,
    originalTitle: item.originalTitle ?? null,
    originalLanguage: item.originalLanguage ?? null,
    originCountries: item.originCountries ?? [],
    overview: item.overview ?? null,
    tagline: item.tagline ?? null,
    releaseDate: item.releaseDate ?? null,
    runtime: item.runtime ?? null,
    status: item.status ?? (item.kind === "series"
      ? "returning"
      : "released"),
    contentRating: item.contentRating ?? null,
    isAdult: item.isAdult ?? false,
    voteAverage: item.voteAverage ?? null,
    voteCount: item.voteCount ?? null,
    popularity: item.popularity ?? 0,
    sort: item.sort ?? 0,
    collectionId: item.collection
      ? collectionIdOf(item.collection.externalId)
      : null,
    genreIds: [
      ...new Set(item.genreIds ?? []),
    ].sort(),
    translations: [
      ...(item.translations ?? []),
    ].sort((a, b) => a.locale.localeCompare(b.locale)).map(t => ({
      locale: t.locale,
      title: t.title ?? null,
      overview: t.overview ?? null,
      tagline: t.tagline ?? null,
    })),
    externalIds: sources.flatMap(s => (item.externalIds[s]
      ? [
          [s, item.externalIds[s]!] as [ExternalSource, string],
        ]
      : [])),
    images: (item.images ?? []).map(i => i.url),
    seasons: item.kind === "series"
      ? [
          ...(item.seasons ?? []),
        ].sort((a, b) => a.number - b.number).map(s => ({
          number: s.number,
          name: s.name ?? null,
          overview: s.overview ?? null,
          airDate: s.airDate ?? null,
          episodeTotal: s.episodeTotal ?? null,
          status: seasonStatus(item, s, today),
          poster: s.poster ?? null,
        }))
      : [],
    credits: (item.credits ?? []).map(c => ({
      person: c.person.externalId,
      role: c.role,
      character: c.character ?? null,
      department: c.department ?? null,
      job: c.job ?? null,
    })),
  };
}

async function readStored(db: MediaDb, row: TitleRow): Promise<Stored> {
  const seasonIds = db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(eq(mediaSeasons.titleId, row.id));
  const [genres, translations, externals, images, seasons, seasonImages, credits] = await db.batch([
    db.select({ id: mediaTitleGenres.genreId }).from(mediaTitleGenres).where(eq(mediaTitleGenres.titleId, row.id)),
    db.select({
      locale: mediaTitleTranslations.locale,
      title: mediaTitleTranslations.title,
      overview: mediaTitleTranslations.overview,
      tagline: mediaTitleTranslations.tagline,
    }).from(mediaTitleTranslations).where(eq(mediaTitleTranslations.titleId, row.id)).orderBy(asc(mediaTitleTranslations.locale)),
    db.select({ source: mediaExternalIds.source, externalId: mediaExternalIds.externalId }).from(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, "title"), eq(mediaExternalIds.ownerId, row.id))),
    db.select({ url: mediaImages.url, kind: mediaImages.kind, sort: mediaImages.sort }).from(mediaImages).where(and(eq(mediaImages.ownerType, "title"), eq(mediaImages.ownerId, row.id))),
    db.select().from(mediaSeasons).where(eq(mediaSeasons.titleId, row.id)).orderBy(asc(mediaSeasons.seasonNumber)),
    db.select({
      ownerId: mediaImages.ownerId,
      url: mediaImages.url,
      kind: mediaImages.kind,
      sort: mediaImages.sort,
    }).from(mediaImages).where(and(eq(mediaImages.ownerType, "season"), inArray(mediaImages.ownerId, seasonIds))),
    db.select({
      role: mediaCredits.role,
      character: mediaCredits.character,
      department: mediaCredits.department,
      job: mediaCredits.job,
      person: mediaExternalIds.externalId,
    })
      .from(mediaCredits)
      .leftJoin(mediaExternalIds, and(eq(mediaExternalIds.ownerType, "person"), eq(mediaExternalIds.source, "tmdb"), eq(mediaExternalIds.ownerId, mediaCredits.personId)))
      .where(and(eq(mediaCredits.titleId, row.id), isNull(mediaCredits.seasonId)))
      .orderBy(asc(mediaCredits.sort), asc(mediaCredits.id)),
  ]);
  return {
    genres,
    translations,
    externals,
    images,
    seasons,
    seasonImages,
    credits,
  };
}

/** `stored` shaped like `wanted(item)` so the two compare as JSON; images and external ids only for those `item` asks for. */
function managedOf(row: TitleRow, stored: Stored, item: Managed): Managed {
  const have = new Set(stored.images.map(i => i.url));
  const wantedSeasons = new Map(item.seasons.map(s => [s.number, s]));
  return {
    title: row.title,
    originalTitle: row.originalTitle,
    originalLanguage: row.originalLanguage,
    originCountries: JSON.parse(row.originCountries) as string[],
    overview: row.overview,
    tagline: row.tagline,
    releaseDate: row.releaseDate,
    runtime: row.runtime,
    status: row.status,
    contentRating: row.contentRating,
    isAdult: row.isAdult,
    voteAverage: row.voteAverage,
    voteCount: row.voteCount,
    popularity: row.popularity,
    sort: row.sort,
    collectionId: row.collectionId,
    genreIds: stored.genres.map(g => g.id).sort(),
    translations: stored.translations,
    externalIds: item.externalIds.filter(([source, id]) => stored.externals.some(e => e.source === source && e.externalId === id)),
    images: item.images.filter(url => have.has(url)),
    seasons: stored.seasons.filter(s => wantedSeasons.has(s.seasonNumber)).map((s) => {
      const want = wantedSeasons.get(s.seasonNumber)!;
      const posters = stored.seasonImages.filter(i => i.ownerId === s.id).map(i => i.url);
      return {
        number: s.seasonNumber,
        name: s.name,
        overview: s.overview,
        airDate: s.airDate,
        episodeTotal: s.episodeTotal,
        status: s.status,
        poster: want.poster && posters.includes(want.poster)
          ? want.poster
          : null,
      };
    }),
    credits: stored.credits.map(c => ({
      person: c.person ?? "",
      role: c.role,
      character: c.character,
      department: c.department,
      job: c.job,
    })),
  };
}

const EMPTY: Stored = {
  genres: [],
  translations: [],
  externals: [],
  images: [],
  seasons: [],
  seasonImages: [],
  credits: [],
};

// The ids of media_people by TMDB id across one import call, so a person is created once.
type People = Map<string, string>;

/** Look up the people of `item`'s credits that are not known yet; the rest get created in the write batch. */
async function lookupPeople(db: MediaDb, people: People, item: ImportTitle): Promise<void> {
  const unknown = [
    ...new Set((item.credits ?? []).map(c => c.person.externalId).filter(id => !people.has(id))),
  ];
  for (const part of chunked(unknown)) {
    const linked = await db.select({ ownerId: mediaExternalIds.ownerId, externalId: mediaExternalIds.externalId })
      .from(mediaExternalIds)
      .where(and(eq(mediaExternalIds.ownerType, "person"), eq(mediaExternalIds.source, "tmdb"), inArray(mediaExternalIds.externalId, part)))
      .all();
    for (const l of linked)
      people.set(l.externalId, l.ownerId);
  }
}

type ImageInsert = typeof mediaImages.$inferInsert;

/** An image unless the owner already has one with that URL; the first of a kind is primary. */
function ensureImage(
  have: { url: string | null; kind: string; sort: number }[],
  ownerType: "title" | "season" | "person",
  ownerId: string,
  image: { kind: "poster" | "backdrop" | "logo" | "profile"; url: string; locale?: string | null | undefined; width?: number | null | undefined; height?: number | null | undefined },
): ImageInsert | null {
  const same = have.filter(i => i.kind === image.kind);
  if (same.some(i => i.url === image.url))
    return null;
  const row: ImageInsert = {
    id: ulid(),
    ownerType,
    ownerId,
    kind: image.kind,
    url: image.url,
    locale: image.locale ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    isPrimary: same.length === 0,
    sort: same.length === 0
      ? 0
      : Math.max(...same.map(i => i.sort)) + 1,
  };
  have.push(row as { url: string; kind: string; sort: number });
  return row;
}

/** The statements that bring one title to `want`. */
function writeTitle(db: MediaDb, item: ImportTitle, want: Managed, existing: TitleRow | undefined, stored: Stored, people: People): { id: string; statements: Statement[] } {
  const out: Statement[] = [];
  const images: ImageInsert[] = [];
  if (item.collection) {
    const id = want.collectionId!;
    out.push(db.insert(mediaCollections)
      .values({ id, name: item.collection.name, overview: item.collection.overview ?? null })
      .onConflictDoUpdate({
        target: mediaCollections.id,
        set: { name: item.collection.name, overview: item.collection.overview ?? null },
      }));
  }
  const { genreIds: _g, translations: _t, externalIds: _e, images: _i, seasons: _s, credits: _c, originCountries, ...columns } = want;
  const values = {
    ...columns,
    originCountries: JSON.stringify(originCountries),
  };
  const id = existing?.id ?? mediaId();
  if (existing) {
    out.push(db.update(mediaTitles).set({
      ...values,
      updatedAt: new Date().toISOString(),
    }).where(eq(mediaTitles.id, id)));
  }
  else {
    out.push(db.insert(mediaTitles).values({
      ...values,
      id,
      kind: item.kind,
      categoryId: item.categoryId,
      publishState: item.publishState ?? DEFAULT_PUBLISH_STATE,
      origin: item.origin ?? DEFAULT_ORIGIN,
    }));
  }

  out.push(db.delete(mediaTitleGenres).where(eq(mediaTitleGenres.titleId, id)));
  out.push(...insertRows(db, mediaTitleGenres, want.genreIds.map(genreId => ({ titleId: id, genreId }))));
  out.push(...replaceTranslations(db, id, want.translations));
  const missingExternal = want.externalIds.filter(([source, externalId]) => !stored.externals.some(h => h.source === source && h.externalId === externalId));
  out.push(...insertRows(db, mediaExternalIds, missingExternal.map(([source, externalId]) => ({
    id: ulid(),
    ownerType: "title" as const,
    ownerId: id,
    source,
    externalId,
  }))));
  const titleImages = [...stored.images];
  for (const image of item.images ?? []) {
    const row = ensureImage(titleImages, "title", id, image);
    if (row)
      images.push(row);
  }

  if (item.kind === "series") {
    if (want.seasons.length === 0 && stored.seasons.length === 0) {
      out.push(db.insert(mediaSeasons).values({
        id: mediaId(),
        titleId: id,
        seasonNumber: 1,
        sort: 1,
      }));
    }
    for (const s of want.seasons) {
      const fields = {
        name: s.name,
        overview: s.overview,
        airDate: s.airDate,
        episodeTotal: s.episodeTotal,
        status: s.status,
      };
      const current = stored.seasons.find(e => e.seasonNumber === s.number);
      const seasonId = current?.id ?? mediaId();
      if (current) {
        out.push(db.update(mediaSeasons).set({
          ...fields,
          updatedAt: new Date().toISOString(),
        }).where(eq(mediaSeasons.id, seasonId)));
      }
      else {
        out.push(db.insert(mediaSeasons).values({
          ...fields,
          id: seasonId,
          titleId: id,
          seasonNumber: s.number,
          sort: s.number,
          publishState: item.publishState ?? DEFAULT_PUBLISH_STATE,
        }));
      }
      if (s.poster) {
        const row = ensureImage(stored.seasonImages.filter(i => i.ownerId === seasonId), "season", seasonId, { kind: "poster", url: s.poster });
        if (row)
          images.push(row);
      }
    }
  }

  out.push(db.delete(mediaCredits).where(and(eq(mediaCredits.titleId, id), isNull(mediaCredits.seasonId))));
  const credits: typeof mediaCredits.$inferInsert[] = [];
  const newPeople: typeof mediaPeople.$inferInsert[] = [];
  const links: typeof mediaExternalIds.$inferInsert[] = [];
  for (const [sort, credit] of (item.credits ?? []).entries()) {
    let personId = people.get(credit.person.externalId);
    if (personId === undefined) {
      personId = mediaId();
      people.set(credit.person.externalId, personId);
      newPeople.push({ id: personId, name: credit.person.name, originalName: credit.person.originalName ?? null });
      links.push({
        id: ulid(),
        ownerType: "person",
        ownerId: personId,
        source: "tmdb",
        externalId: credit.person.externalId,
      });
      if (credit.person.profile)
        images.push(ensureImage([], "person", personId, { kind: "profile", url: credit.person.profile })!);
    }
    credits.push({
      id: ulid(),
      personId,
      titleId: id,
      role: credit.role,
      character: credit.character ?? null,
      department: credit.department ?? null,
      job: credit.job ?? null,
      sort,
    });
  }
  out.push(...insertRows(db, mediaPeople, newPeople), ...insertRows(db, mediaExternalIds, links), ...insertRows(db, mediaImages, images), ...insertRows(db, mediaCredits, credits));
  return { id, statements: out };
}

export async function importTitles(db: MediaDb, titles: readonly ImportTitle[], today = new Date().toISOString().slice(0, 10)): Promise<ImportResult[]> {
  const people: People = new Map();
  const results: ImportResult[] = [];
  for (const item of titles) {
    const externalId = item.externalIds.tmdb;
    const linked = await db.select({ ownerId: mediaExternalIds.ownerId }).from(mediaExternalIds).where(and(eq(mediaExternalIds.ownerType, "title"), eq(mediaExternalIds.source, "tmdb"), eq(mediaExternalIds.externalId, externalId))).get();
    const existing = linked
      ? await db.select().from(mediaTitles).where(eq(mediaTitles.id, linked.ownerId)).get()
      : undefined;
    if (existing && existing.origin !== (item.origin ?? DEFAULT_ORIGIN)) {
      results.push({ externalId, id: existing.id, action: "skipped" });
      continue;
    }
    if (!existing)
      await assertCategoryAccepts(db, item.categoryId, item.kind);
    if (item.genreIds?.length)
      await assertGenres(db, item.genreIds);

    const want = wanted(item, today);
    const stored = existing
      ? await readStored(db, existing)
      : EMPTY;
    if (existing && JSON.stringify(managedOf(existing, stored, want)) === JSON.stringify(want)) {
      results.push({ externalId, id: existing.id, action: "unchanged" });
      continue;
    }
    await lookupPeople(db, people, item);
    const added = new Map(people);
    const { id, statements } = writeTitle(db, item, want, existing, stored, people);
    try {
      await runBatch(db, statements);
    }
    catch (err) {
      // The batch rolled back, so the people it would have created do not exist.
      for (const key of people.keys()) {
        if (!added.has(key))
          people.delete(key);
      }
      if (isUniqueViolation(err))
        throw new AppError(`An external id of ${externalId} is linked to another title`, 409, "EXTERNAL_ID_TAKEN");
      throw err;
    }
    if (item.kind === "series")
      await refreshSeriesStatus(db, id);
    results.push({
      externalId,
      id,
      action: existing ? "updated" : "created",
    });
  }
  return results;
}
