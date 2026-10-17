import type {
  Card,
  Collection,
  Credits,
  Episode,
  Facets,
  Home,
  Image,
  Images,
  Live,
  Manifest,
  Person,
  PersonRef,
  Playback,
  SeasonDetail,
  SeasonSummary,
  TitleDetail,
} from "../contract";
import type {
  mediaCategories,
  mediaCollections,
  mediaCredits,
  mediaEpisodes,
  mediaExternalIds,
  mediaGenres,
  mediaImages,
  mediaLiveChannels,
  mediaLiveGroups,
  mediaLiveStreams,
  mediaPeople,
  mediaRowItems,
  mediaRows,
  mediaSeasons,
  mediaSources,
  mediaStreams,
  mediaTitleAliases,
  mediaTitles,
  mediaTitleTranslations,
} from "../schema";
import type { RowRule } from "../taxonomy/rows.service";
import type { CmsItemDoc } from "./cms";
import { createHash } from "node:crypto";
import { ASSET_PREFIX, SCHEMA_VERSION } from "../contract";
import { buildCmsItems } from "./cms";
import { countryName, languageName } from "./names";

/**
 * Source rows → the read model: the native API's documents plus the columns
 * D1 filters and pages by. Pure, so it is tested without a database; the
 * projector loads `Library` and writes what this returns.
 */

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export interface Library {
  readonly categories: Row<typeof mediaCategories>[];
  readonly genres: Row<typeof mediaGenres>[];
  readonly collections: Row<typeof mediaCollections>[];
  readonly titles: Row<typeof mediaTitles>[];
  readonly aliases: Row<typeof mediaTitleAliases>[];
  readonly translations: Row<typeof mediaTitleTranslations>[];
  readonly titleGenres: { titleId: string; genreId: string }[];
  readonly seasons: Row<typeof mediaSeasons>[];
  readonly episodes: Row<typeof mediaEpisodes>[];
  readonly people: Row<typeof mediaPeople>[];
  readonly credits: Row<typeof mediaCredits>[];
  readonly images: Row<typeof mediaImages>[];
  readonly externalIds: Row<typeof mediaExternalIds>[];
  readonly sources: Row<typeof mediaSources>[];
  readonly streams: Row<typeof mediaStreams>[];
  readonly rows: Row<typeof mediaRows>[];
  readonly rowItems: Row<typeof mediaRowItems>[];
  readonly hero: string[];
  readonly liveGroups: Row<typeof mediaLiveGroups>[];
  readonly liveChannels: Row<typeof mediaLiveChannels>[];
  readonly liveStreams: Row<typeof mediaLiveStreams>[];
  readonly liveEpg: string[];
}

export interface TitleDoc {
  readonly id: string;
  readonly type: "movie" | "series";
  readonly categoryId: string;
  readonly year: number | null;
  readonly country: string | null;
  readonly language: string | null;
  readonly rating: number;
  readonly popularity: number;
  readonly releaseKey: string;
  readonly updatedAt: string;
  readonly manualSort: number;
  readonly genreIds: string[];
  readonly card: Card;
  readonly detail: TitleDetail;
}

export interface SeasonDoc {
  readonly id: string;
  readonly titleId: string;
  readonly number: number;
  readonly detail: SeasonDetail;
}

export interface PlaybackDoc {
  readonly id: string;
  readonly titleId: string;
  readonly seasonId: string | null;
  readonly episodeNumber: number | null;
  readonly doc: Playback;
}

export interface RowDoc {
  readonly id: string;
  readonly name: string;
  readonly sort: number;
  readonly titleIds: string[];
}

export interface ReadModel {
  readonly titles: TitleDoc[];
  readonly seasons: SeasonDoc[];
  readonly playback: PlaybackDoc[];
  readonly people: { id: string; doc: Person }[];
  readonly collections: { id: string; doc: Collection }[];
  readonly rows: RowDoc[];
  readonly search: { ref: string; type: "title" | "person"; text: string }[];
  readonly cmsItems: CmsItemDoc[];
  /** rm_meta: manifest, home, facets:<category>, live. */
  readonly meta: Record<string, unknown>;
}

export function hashOf(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

const HOME_ROW_ITEMS = 20;
const DETAIL_CAST = 50;

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list)
      list.push(item);
    else
      out.set(k, [item]);
  }
  return out;
}

const yearOf = (date: string | null | undefined): number | null => (date ? Number(date.slice(0, 4)) || null : null);

export function buildReadModel(lib: Library, today: string): ReadModel {
  // ─── Indexes ───
  const genreName = new Map(lib.genres.map(g => [g.id, g.name]));
  const categories = new Map(lib.categories.map(c => [c.id, c]));
  const imagesByOwner = groupBy(lib.images, i => `${i.ownerType}:${i.ownerId}`);
  const aliasesByTitle = groupBy(lib.aliases, a => a.titleId);
  const translationsByTitle = groupBy(lib.translations, t => t.titleId);
  const genresByTitle = groupBy(lib.titleGenres, g => g.titleId);
  const externalByTitle = groupBy(lib.externalIds.filter(e => e.ownerType === "title"), e => e.ownerId);
  const people = new Map(lib.people.map(p => [p.id, p]));
  const creditsByTitle = groupBy(lib.credits, c => c.titleId);
  const enabledSources = lib.sources.filter(s => s.enabled);
  const sourcesByTitle = groupBy(enabledSources.filter(s => s.titleId !== null), s => s.titleId!);
  const sourcesBySeason = groupBy(enabledSources.filter(s => s.seasonId !== null), s => s.seasonId!);
  const streamsBySource = groupBy(lib.streams, s => s.sourceId);
  const publishedSeasons = groupBy(lib.seasons.filter(s => s.publishState === "published"), s => s.titleId);
  const episodesBySeason = groupBy(lib.episodes.filter(e => e.publishState === "published"), e => e.seasonId);
  const collections = new Map(lib.collections.map(c => [c.id, c]));

  const image = (ownerType: string, ownerId: string | number, kind: string): Image | null => {
    const candidates = (imagesByOwner.get(`${ownerType}:${ownerId}`) ?? []).filter(i => i.kind === kind);
    const pick = candidates.find(i => i.isPrimary) ?? candidates.sort((a, b) => a.sort - b.sort)[0];
    if (!pick)
      return null;
    const url = pick.url ?? `${ASSET_PREFIX}${pick.assetSha256}/${pick.assetName ?? "image"}`;
    return { url, w: pick.width, h: pick.height };
  };
  const images = (ownerType: string, ownerId: string | number, kinds: readonly (keyof Images)[]): Images =>
    Object.fromEntries(kinds.map(k => [k, image(ownerType, ownerId, k)])) as Images;

  const headersOf = (s: { userAgent: string | null; referer: string | null }): Record<string, string> => ({
    ...(s.userAgent ? { "User-Agent": s.userAgent } : {}),
    ...(s.referer ? { Referer: s.referer } : {}),
  });

  const credits = (titleId: string, seasonId: string | null): Credits => {
    const all = creditsByTitle.get(titleId) ?? [];
    const own = seasonId === null ? [] : all.filter(c => c.seasonId === seasonId);
    const picked = (own.length > 0 ? own : all.filter(c => c.seasonId === null)).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    const ref = (c: typeof picked[number]): PersonRef => {
      const p = people.get(c.personId)!;
      return { id: p.id, name: p.name, character: c.character, job: c.job, images: images("person", p.id, ["profile"]) };
    };
    const crew = picked.filter(c => c.role === "crew");
    return {
      directors: crew.filter(c => c.job === "Director").map(ref),
      writers: crew.filter(c => c.job === "Writer" || c.job === "Screenplay" || c.job === "Creator").map(ref),
      cast: picked.filter(c => c.role === "cast").slice(0, DETAIL_CAST).map(ref),
    };
  };

  // ─── Seasons and playback ───

  interface SeasonWork {
    row: Row<typeof mediaSeasons>;
    episodes: (Row<typeof mediaEpisodes> & { available: boolean })[];
    summary: SeasonSummary;
  }

  const playback: PlaybackDoc[] = [];
  const seasonDocs: SeasonDoc[] = [];
  const seasonWork = new Map<string, SeasonWork[]>();

  const seasonName = (s: Row<typeof mediaSeasons>) => s.name ?? (s.seasonNumber === 0 ? "特别篇" : `第 ${s.seasonNumber} 季`);
  const episodeName = (e: Row<typeof mediaEpisodes>) => e.name ?? (e.episodeType === "special" ? `特别篇 ${e.episodeNumber}` : `第 ${e.episodeNumber} 集`);

  for (const title of lib.titles) {
    if (title.publishState !== "published" || title.kind !== "series" || !categories.has(title.categoryId))
      continue;
    const works: SeasonWork[] = [];
    for (const row of (publishedSeasons.get(title.id) ?? []).sort((a, b) => a.sort - b.sort || a.seasonNumber - b.seasonNumber)) {
      const sources = (sourcesBySeason.get(row.id) ?? []).sort((a, b) => a.sort - b.sort);
      const episodes = (episodesBySeason.get(row.id) ?? []).sort((a, b) => a.episodeNumber - b.episodeNumber).map((e) => {
        const playable = sources.some(s => (streamsBySource.get(s.id) ?? []).some(st => st.episodeId === e.id));
        return { ...e, available: playable && (!e.airDate || e.airDate <= today) };
      });
      const available = episodes.filter(e => e.available);
      const upcoming = episodes.filter(e => e.airDate && e.airDate > today).map(e => e.airDate!).sort();
      works.push({
        row,
        episodes,
        summary: {
          id: row.id,
          number: row.seasonNumber,
          name: seasonName(row),
          status: row.status,
          airDate: row.airDate,
          episodeCount: row.episodeTotal ?? episodes.length,
          availableCount: available.length,
          schedule: row.updateSchedule,
          nextAirDate: upcoming[0] ?? null,
          images: {
            poster: image("season", row.id, "poster") ?? image("title", title.id, "poster"),
            backdrop: image("season", row.id, "backdrop") ?? image("title", title.id, "backdrop"),
          },
        },
      });
    }
    seasonWork.set(title.id, works);
  }

  // ─── Titles ───

  const titleDocs: TitleDoc[] = [];
  const included = new Map<string, TitleDoc>();

  for (const title of lib.titles) {
    if (title.publishState !== "published" || !categories.has(title.categoryId))
      continue;
    const works = seasonWork.get(title.id) ?? [];
    if (title.kind === "series" && works.length === 0)
      continue;

    const genreIds = (genresByTitle.get(title.id) ?? []).map(g => g.genreId).sort();
    const countries = JSON.parse(title.originCountries) as string[];
    const movieSources = title.kind === "movie" ? (sourcesByTitle.get(title.id) ?? []).sort((a, b) => a.sort - b.sort) : [];
    const movieStreams = movieSources.map(s => ({ source: s, streams: (streamsBySource.get(s.id) ?? []).filter(st => st.episodeId === null).sort((a, b) => a.sort - b.sort) }))
      .filter(x => x.streams.length > 0);
    const movieAvailable = movieStreams.length > 0 && (!title.releaseDate || title.releaseDate <= today);

    // The season a client opens first: the newest regular one with something to play.
    const regular = works.filter(w => w.row.seasonNumber > 0);
    const playable = (regular.length > 0 ? regular : works).filter(w => w.summary.availableCount > 0);
    const current = [...playable].sort((a, b) => b.row.seasonNumber - a.row.seasonNumber)[0];
    const firstAir = works.map(w => w.row.airDate).filter((d): d is string => !!d).sort()[0] ?? title.releaseDate;

    let badge: string | null;
    if (title.kind === "movie") {
      const quality = movieStreams.map(x => x.source.quality ?? x.streams[0]!.resolution).find(q => !!q) ?? null;
      badge = movieAvailable ? quality : "即将上线";
    }
    else if (!current) {
      badge = "即将上线";
    }
    else {
      const s = current.summary;
      const last = Math.max(...current.episodes.filter(e => e.available).map(e => e.episodeNumber));
      const body = s.status === "ended" && s.availableCount >= s.episodeCount ? `全 ${s.episodeCount} 集` : `更新至第 ${last} 集`;
      badge = regular.length > 1 ? `${s.name} ${body}` : body;
    }

    const card: Card = {
      id: title.id,
      type: title.kind,
      category: title.categoryId,
      title: title.title,
      year: yearOf(firstAir),
      images: { poster: image("title", title.id, "poster"), backdrop: image("title", title.id, "backdrop") },
      badge,
      rating: title.voteAverage,
      genres: genreIds,
    };
    const collection = title.collectionId ? collections.get(title.collectionId) : undefined;
    const detail: TitleDetail = {
      ...card,
      images: images("title", title.id, ["poster", "backdrop", "logo"]),
      originalTitle: title.originalTitle,
      aliases: (aliasesByTitle.get(title.id) ?? []).map(a => a.name),
      overview: title.overview,
      tagline: title.tagline,
      status: title.status,
      contentRating: title.contentRating,
      isAdult: title.isAdult,
      countries,
      language: title.originalLanguage,
      releaseDate: title.releaseDate ?? firstAir ?? null,
      runtime: title.runtime,
      voteCount: title.voteCount,
      credits: credits(title.id, null),
      collection: collection ? { id: collection.id, name: collection.name } : null,
      externalIds: Object.fromEntries((externalByTitle.get(title.id) ?? []).map(e => [e.source, e.externalId])),
      translations: Object.fromEntries((translationsByTitle.get(title.id) ?? []).map(x => [x.locale, { title: x.title, overview: x.overview, tagline: x.tagline }])),
      seasons: works.map(w => w.summary),
      defaultSeason: current ? current.summary.id : works[0] ? works[0].summary.id : null,
      available: title.kind === "movie" ? movieAvailable : !!current,
      updatedAt: title.updatedAt,
    };
    const doc: TitleDoc = {
      id: title.id,
      type: title.kind,
      categoryId: title.categoryId,
      year: card.year,
      country: countries[0] ?? null,
      language: title.originalLanguage,
      rating: title.voteAverage ?? 0,
      popularity: title.popularity,
      releaseKey: firstAir ?? "",
      updatedAt: title.updatedAt,
      manualSort: title.sort,
      genreIds,
      card,
      detail,
    };
    titleDocs.push(doc);
    included.set(title.id, doc);

    if (title.kind === "movie" && movieAvailable) {
      playback.push({
        id: title.id,
        titleId: title.id,
        seasonId: null,
        episodeNumber: null,
        doc: {
          id: title.id,
          titleId: title.id,
          seasonId: null,
          episode: null,
          sources: movieStreams.map(x => ({
            id: x.source.id,
            name: x.source.name,
            quality: x.source.quality,
            streams: x.streams.map(st => ({ url: st.url, format: st.format, resolution: st.resolution, audio: st.audioLocale, headers: headersOf(st) })),
          })),
          next: null,
          subtitles: [],
          markers: null,
          expiresAt: null,
        },
      });
    }

    // Seasons, their episodes and what each episode plays.
    const order = [...regular].sort((a, b) => a.row.seasonNumber - b.row.seasonNumber);
    for (const work of works) {
      const sources = (sourcesBySeason.get(work.row.id) ?? []).sort((a, b) => a.sort - b.sort);
      const available = work.episodes.filter(e => e.available);
      const episodes: Episode[] = work.episodes.map(e => ({
        id: e.id,
        number: e.episodeNumber,
        type: e.episodeType,
        name: episodeName(e),
        overview: e.overview,
        airDate: e.airDate,
        runtime: e.runtime,
        images: { still: image("episode", e.id, "still") },
        available: e.available,
      }));
      seasonDocs.push({
        id: work.row.id,
        titleId: title.id,
        number: work.row.seasonNumber,
        detail: {
          ...work.summary,
          titleId: title.id,
          title: title.title,
          overview: work.row.overview ?? title.overview,
          endDate: work.row.endDate,
          contentRating: work.row.contentRating ?? title.contentRating,
          credits: credits(title.id, work.row.id),
          episodes,
        },
      });

      // The next episode: later in this season, else the first of the next regular season.
      const nextSeason = work.row.seasonNumber > 0 ? order.find(w => w.row.seasonNumber > work.row.seasonNumber && w.summary.availableCount > 0) : undefined;
      available.forEach((e, i) => {
        const following = available[i + 1] ?? nextSeason?.episodes.find(x => x.available);
        const followingSeason = available[i + 1] ? work : nextSeason;
        playback.push({
          id: e.id,
          titleId: title.id,
          seasonId: work.row.id,
          episodeNumber: e.episodeNumber,
          doc: {
            id: e.id,
            titleId: title.id,
            seasonId: work.row.id,
            episode: { number: e.episodeNumber, name: episodeName(e) },
            sources: sources.map(s => ({
              id: s.id,
              name: s.name,
              quality: s.quality,
              streams: (streamsBySource.get(s.id) ?? []).filter(st => st.episodeId === e.id).sort((a, b) => a.sort - b.sort).map(st => ({ url: st.url, format: st.format, resolution: st.resolution, audio: st.audioLocale, headers: headersOf(st) })),
            })).filter(s => s.streams.length > 0),
            next: following && followingSeason ? { id: following.id, seasonId: followingSeason.row.id, number: following.episodeNumber } : null,
            subtitles: [],
            markers: null,
            expiresAt: null,
          },
        });
      });
    }
  }

  // ─── People, collections ───

  const creditsByPerson = groupBy(lib.credits.filter(c => included.has(c.titleId)), c => c.personId);
  const peopleDocs: { id: string; doc: Person }[] = [];
  for (const [personId, list] of creditsByPerson) {
    const p = people.get(personId);
    if (!p)
      continue;
    const seen = new Set<string>();
    const entries = list
      .map(c => ({ c, t: included.get(c.titleId)! }))
      .sort((a, b) => b.t.releaseKey.localeCompare(a.t.releaseKey) || a.t.id.localeCompare(b.t.id))
      .filter(({ c }) => {
        const key = `${c.titleId}:${c.role}:${c.job ?? ""}`;
        if (seen.has(key))
          return false;
        seen.add(key);
        return true;
      });
    peopleDocs.push({
      id: p.id,
      doc: {
        id: p.id,
        name: p.name,
        originalName: p.originalName,
        gender: p.gender,
        biography: p.biography,
        birthday: p.birthday,
        placeOfBirth: p.placeOfBirth,
        images: images("person", p.id, ["profile"]),
        credits: entries.map(({ c, t }) => ({ title: t.card, role: c.role, character: c.character, job: c.job })),
      },
    });
  }

  const collectionOf = new Map(lib.titles.map(t => [t.id, t.collectionId]));
  const collectionDocs: { id: string; doc: Collection }[] = [];
  for (const c of lib.collections) {
    const members = titleDocs.filter(t => collectionOf.get(t.id) === c.id)
      .sort((a, b) => a.releaseKey.localeCompare(b.releaseKey) || a.id.localeCompare(b.id));
    if (members.length === 0)
      continue;
    collectionDocs.push({ id: c.id, doc: { id: c.id, name: c.name, overview: c.overview, images: images("collection", c.id, ["poster", "backdrop"]), titles: members.map(m => m.card) } });
  }

  // ─── Rows and home ───

  const sorters: Record<RowRule["sort"], (a: TitleDoc, b: TitleDoc) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    popular: (a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id),
    release: (a, b) => b.releaseKey.localeCompare(a.releaseKey) || a.id.localeCompare(b.id),
    rating: (a, b) => b.rating - a.rating || a.id.localeCompare(b.id),
  };
  const itemsByRow = groupBy(lib.rowItems, i => i.rowId);
  const rows: RowDoc[] = [...lib.rows].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map((r) => {
    let titleIds: string[];
    if (r.kind === "rule" && r.rule) {
      const rule = JSON.parse(r.rule) as RowRule;
      titleIds = titleDocs
        .filter(t => (!rule.categoryId || t.categoryId === rule.categoryId) && (!rule.kind || t.type === rule.kind) && (!rule.genreId || t.genreIds.includes(rule.genreId)))
        .sort(sorters[rule.sort ?? "updated"])
        .slice(0, rule.limit ?? 20)
        .map(t => t.id);
    }
    else {
      titleIds = (itemsByRow.get(r.id) ?? []).sort((a, b) => a.sort - b.sort).map(i => i.titleId).filter(id => included.has(id));
    }
    return { id: r.id, name: r.name, sort: r.sort, titleIds };
  }).filter(r => r.titleIds.length > 0);

  const onHome = new Set(lib.rows.filter(r => r.onHome).map(r => r.id));
  const home: Home = {
    hero: lib.hero.filter(id => included.has(id)).map((id) => {
      const t = included.get(id)!;
      return { ...t.card, images: t.detail.images, overview: t.detail.overview, tagline: t.detail.tagline };
    }),
    rows: rows.filter(r => onHome.has(r.id)).map(r => ({
      id: r.id,
      name: r.name,
      items: r.titleIds.slice(0, HOME_ROW_ITEMS).map(id => included.get(id)!.card),
      cursor: r.titleIds.length > HOME_ROW_ITEMS ? String(HOME_ROW_ITEMS) : null,
    })),
  };

  // ─── Facets, manifest ───

  const meta: Record<string, unknown> = { home };
  const byCategory = groupBy(titleDocs, t => t.categoryId);
  for (const category of lib.categories) {
    const docs = byCategory.get(category.id) ?? [];
    meta[`facets:${category.id}`] = facetsOf(docs, genreName);
  }
  const usedCountries = [...new Set(titleDocs.flatMap(t => t.detail.countries))].sort();
  const usedLanguages = [...new Set(titleDocs.map(t => t.language).filter((l): l is string => !!l))].sort();
  const manifest: Omit<Manifest, "generation"> = {
    schemaVersion: SCHEMA_VERSION,
    categories: [...lib.categories].sort((a, b) => a.sort - b.sort).map(c => ({
      id: c.id,
      name: c.name,
      kinds: JSON.parse(c.kinds) as ("movie" | "series")[],
      filters: JSON.parse(c.filters) as ("genre" | "year" | "country")[],
      count: byCategory.get(c.id)?.length ?? 0,
    })),
    genres: [...lib.genres].sort((a, b) => a.sort - b.sort).map(g => ({ id: g.id, name: g.name })),
    countries: usedCountries.map(code => ({ code, name: countryName(code) })),
    languages: usedLanguages.map(code => ({ code, name: languageName(code) })),
    rows: rows.map(r => r.id),
    capabilities: { live: lib.liveChannels.some(c => c.enabled) },
  };
  meta.manifest = manifest;
  meta.live = buildLive(lib);

  // ─── Search, CMS items ───

  const search = [
    ...titleDocs.map(t => ({
      ref: t.id,
      type: "title" as const,
      text: [t.card.title, t.detail.originalTitle, ...t.detail.aliases, ...Object.values(t.detail.translations).map(x => x.title), ...t.detail.credits.cast.slice(0, 10).map(c => c.name), ...t.detail.credits.directors.map(d => d.name)]
        .filter(Boolean)
        .join(" "),
    })),
    ...peopleDocs.map(p => ({ ref: p.id, type: "person" as const, text: [p.doc.name, p.doc.originalName].filter(Boolean).join(" ") })),
  ];

  const cmsItems = buildCmsItems(titleDocs, seasonDocs, playback, new Map(lib.categories.map(c => [c.id, c.name])), genreName);

  return {
    titles: titleDocs,
    seasons: seasonDocs,
    playback,
    people: peopleDocs,
    collections: collectionDocs,
    rows,
    search,
    cmsItems,
    meta,
  };
}

function facetsOf(docs: readonly TitleDoc[], genreName: Map<string, string>): Facets {
  const count = (values: (string | null)[]) => {
    const out = new Map<string, number>();
    for (const v of values) {
      if (v)
        out.set(v, (out.get(v) ?? 0) + 1);
    }
    return out;
  };
  const genres = count(docs.flatMap(d => d.genreIds));
  const years = count(docs.map(d => (d.year ? String(d.year) : null)));
  const countries = count(docs.map(d => d.country));
  return {
    genre: [...genres].map(([value, n]) => ({ value, label: genreName.get(value) ?? value, count: n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    year: [...years].map(([value, n]) => ({ value, label: value, count: n })).sort((a, b) => b.value.localeCompare(a.value)),
    country: [...countries].map(([value, n]) => ({ value, label: countryName(value), count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

export function buildLive(lib: Pick<Library, "liveGroups" | "liveChannels" | "liveStreams" | "liveEpg">): Live {
  const channelsByGroup = groupBy(lib.liveChannels.filter(c => c.enabled), c => c.groupId);
  const streamsByChannel = groupBy(lib.liveStreams, s => s.channelId);
  return {
    epg: lib.liveEpg,
    groups: [...lib.liveGroups].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map(g => ({
      id: g.id,
      name: g.name,
      channels: (channelsByGroup.get(g.id) ?? []).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map(c => ({
        id: c.id,
        number: c.number,
        name: c.name,
        tvgId: c.tvgId,
        logo: c.logo,
        streams: (streamsByChannel.get(c.id) ?? []).sort((a, b) => a.sort - b.sort).map(s => ({
          url: s.url,
          label: s.label,
          headers: { ...(s.userAgent ? { "User-Agent": s.userAgent } : {}), ...(s.referer ? { Referer: s.referer } : {}) },
        })),
      })).filter(c => c.streams.length > 0),
    })).filter(g => g.channels.length > 0),
  };
}
