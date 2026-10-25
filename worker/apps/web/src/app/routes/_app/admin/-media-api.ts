import { http } from "@/shared/lib/http";

export type TitleKind = "movie" | "series";
export type PublishState = "draft" | "published" | "hidden";
export type TitleStatus = "upcoming" | "released" | "returning" | "ended" | "canceled";
export type SeasonStatus = "upcoming" | "airing" | "ended";
export type EpisodeType = "standard" | "premiere" | "finale" | "special";
export type ImageKind = "poster" | "backdrop" | "logo" | "still" | "profile";
export type ImageOwner = "title" | "season" | "episode" | "person" | "collection";
export type ExternalSource = "tmdb" | "imdb" | "tvdb" | "douban";

export const PUBLISH_STATES: readonly PublishState[] = ["draft", "published", "hidden"];
export const TITLE_STATUSES: readonly TitleStatus[] = [
  "upcoming",
  "released",
  "returning",
  "ended",
  "canceled",
];
export const SEASON_STATUSES: readonly SeasonStatus[] = ["upcoming", "airing", "ended"];
export const EPISODE_TYPES: readonly EpisodeType[] = [
  "standard",
  "premiere",
  "finale",
  "special",
];
export const EXTERNAL_SOURCES: readonly ExternalSource[] = ["tmdb", "imdb", "tvdb", "douban"];

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly kinds: TitleKind[];
  readonly filters: ("genre" | "year" | "country")[];
  readonly sort: number;
  readonly titleCount: number;
}

export interface Genre {
  readonly id: string;
  readonly name: string;
  readonly tmdbId: number | null;
  readonly sort: number;
}

export interface Collection {
  readonly id: string;
  readonly name: string;
  readonly overview: string | null;
  readonly titleCount: number;
}

export interface Title {
  readonly id: string;
  readonly kind: TitleKind;
  readonly categoryId: string;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly originalLanguage: string | null;
  readonly originCountries: string[];
  readonly overview: string | null;
  readonly tagline: string | null;
  readonly releaseDate: string | null;
  readonly runtime: number | null;
  readonly status: TitleStatus;
  readonly statusLocked: boolean;
  readonly contentRating: string | null;
  readonly voteAverage: number | null;
  readonly popularity: number;
  readonly collectionId: string | null;
  readonly publishState: PublishState;
  readonly genreIds: string[];
  readonly aliases: { id: string; name: string; locale: string | null; kind: "alias" | "translation" }[];
  readonly translations: Translation[];
  readonly seasonCount: number;
  readonly updatedAt: string;
}

export interface Translation {
  readonly id: string;
  readonly locale: string;
  readonly title: string | null;
  readonly overview: string | null;
  readonly tagline: string | null;
}

export type TranslationInput = Pick<Translation, "title" | "overview" | "tagline">;

export type TitleInput = Partial<Omit<Title, "id" | "kind" | "aliases" | "translations" | "seasonCount" | "updatedAt">> & {
  aliases?: { name: string }[];
};

export interface Season {
  readonly id: string;
  readonly titleId: string;
  readonly seasonNumber: number;
  readonly name: string | null;
  readonly overview: string | null;
  readonly airDate: string | null;
  readonly endDate: string | null;
  readonly status: SeasonStatus;
  readonly episodeTotal: number | null;
  readonly updateSchedule: string | null;
  readonly publishState: PublishState;
  readonly episodeCount: number;
  readonly publishedEpisodeCount: number;
}

export interface Episode {
  readonly id: string;
  readonly seasonId: string;
  readonly episodeNumber: number;
  readonly episodeType: EpisodeType;
  readonly name: string | null;
  readonly overview: string | null;
  readonly airDate: string | null;
  readonly runtime: number | null;
  readonly publishState: "draft" | "published";
}

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly quality: string | null;
  readonly enabled: boolean;
  readonly sort: number;
  readonly streamCount: number;
}

export interface Stream {
  readonly id: string;
  readonly episodeId: string | null;
  readonly url: string;
  readonly format: "hls" | "mp4" | "dash";
  readonly resolution: string | null;
}

export interface PasteResult {
  readonly matched: { episodeNumber: number; line: { name: string; url: string } }[];
  readonly missing: { episodeNumber: number; line: { name: string; url: string } }[];
  readonly unmatched: { line: { name: string; url: string }; reason: "no-number" | "duplicate" | "no-episode" }[];
  readonly written: number;
  readonly created: number;
}

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly originalName: string | null;
  readonly gender: "female" | "male" | "other" | null;
  readonly biography: string | null;
  readonly birthday: string | null;
  readonly placeOfBirth: string | null;
}

export interface Credit {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly seasonId: string | null;
  readonly role: "cast" | "crew";
  readonly character: string | null;
  readonly job: string | null;
  readonly sort: number;
}

export interface MediaImage {
  readonly id: string;
  readonly kind: ImageKind;
  readonly url: string | null;
  readonly assetSha256: string | null;
  readonly assetName: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly isPrimary: boolean;
}

export interface ExternalId {
  readonly id: string;
  readonly source: ExternalSource;
  readonly externalId: string;
}

export interface RowRule {
  categoryId?: string;
  genreId?: string;
  kind?: TitleKind;
  sort: "updated" | "popular" | "release" | "rating";
  limit: number;
}

export interface Row {
  readonly id: string;
  readonly name: string;
  readonly kind: "manual" | "rule";
  readonly rule: RowRule | null;
  readonly onHome: boolean;
  readonly sort: number;
  readonly titleIds: string[];
}

export interface LiveGroup {
  readonly id: string;
  readonly name: string;
  readonly sort: number;
  readonly channelCount: number;
}

export interface LiveStream {
  url: string;
  label?: string | null;
  userAgent?: string | null;
  referer?: string | null;
}

export interface LiveChannel {
  readonly id: string;
  readonly groupId: string;
  readonly number: number | null;
  readonly name: string;
  readonly tvgId: string | null;
  readonly logo: string | null;
  readonly enabled: boolean;
  readonly streams: LiveStream[];
}

export interface ImportResult {
  readonly groups: number;
  readonly channels: number;
  readonly streams: number;
  readonly skipped: number;
}

export interface Paged<T> {
  readonly items: T[];
  readonly total: number;
}

export const mediaKeys = {
  all: ["media"] as const,
  categories: ["media", "categories"] as const,
  genres: ["media", "genres"] as const,
  collections: ["media", "collections"] as const,
  titles: (query: Record<string, string | number | undefined>) => ["media", "titles", query] as const,
  title: (id: string) => ["media", "title", id] as const,
  seasons: (titleId: string) => ["media", "seasons", titleId] as const,
  episodes: (seasonId: string) => ["media", "episodes", seasonId] as const,
  sources: (owner: SourceOwner) => [
    "media",
    "sources",
    owner.kind,
    owner.id,
  ] as const,
  streams: (sourceId: string) => ["media", "streams", sourceId] as const,
  people: (q: string, page: number) => ["media", "people", q, page] as const,
  credits: (titleId: string) => ["media", "credits", titleId] as const,
  images: (owner: ImageOwner, id: string) => ["media", "images", owner, id] as const,
  externalIds: (titleId: string) => ["media", "external-ids", titleId] as const,
  translations: (titleId: string) => ["media", "translations", titleId] as const,
  rows: ["media", "rows"] as const,
  hero: ["media", "hero"] as const,
  liveGroups: ["media", "live", "groups"] as const,
  liveChannels: (groupId: string) => ["media", "live", "channels", groupId] as const,
  epg: ["media", "live", "epg"] as const,
};

export interface SourceOwner {
  readonly kind: "titles" | "seasons";
  readonly id: string;
}

async function data<T>(path: string, init?: RequestInit): Promise<T> {
  return (await http<{ data: T }>(path, init)).data;
}

async function paged<T>(path: string): Promise<Paged<T>> {
  const res = await http<{ data: T[]; meta: { total: number } }>(path);
  return { items: res.data, total: res.meta.total };
}

function send(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : {
        method,
        body: JSON.stringify(body),
      };
}

function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length
    ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}`
    : "";
}

export const mediaApi = {
  categories: () => data<Category[]>("/media/categories"),
  createCategory: (body: { id: string; name: string; kinds: TitleKind[] }) => data<Category>("/media/categories", send("POST", body)),
  updateCategory: (id: string, body: { name?: string; kinds?: TitleKind[] }) => data<Category>(`/media/categories/${id}`, send("PATCH", body)),
  deleteCategory: (id: string) => data<Category>(`/media/categories/${id}`, send("DELETE")),
  reorderCategories: (ids: string[]) => data<unknown>("/media/categories/reorder", send("POST", { ids })),

  genres: () => data<Genre[]>("/media/genres"),
  createGenre: (name: string) => data<Genre>("/media/genres", send("POST", { name })),
  updateGenre: (id: string, name: string) => data<Genre>(`/media/genres/${id}`, send("PATCH", { name })),
  deleteGenre: (id: string) => data<Genre>(`/media/genres/${id}`, send("DELETE")),

  collections: () => data<Collection[]>("/media/collections"),
  createCollection: (body: { name: string; overview?: string | null }) => data<Collection>("/media/collections", send("POST", body)),
  updateCollection: (id: string, body: { name?: string; overview?: string | null }) => data<Collection>(`/media/collections/${id}`, send("PATCH", body)),
  deleteCollection: (id: string) => data<Collection>(`/media/collections/${id}`, send("DELETE")),

  titles: (params: Record<string, string | number | undefined>) => paged<Title>(`/media/titles${query(params)}`),
  title: (id: string) => data<Title>(`/media/titles/${id}`),
  createTitle: (body: TitleInput & { kind: TitleKind; categoryId: string; title: string }) => data<Title>("/media/titles", send("POST", body)),
  updateTitle: (id: string, body: TitleInput) => data<Title>(`/media/titles/${id}`, send("PATCH", body)),
  deleteTitle: (id: string) => data<Title>(`/media/titles/${id}`, send("DELETE")),

  seasons: (titleId: string) => data<Season[]>(`/media/titles/${titleId}/seasons`),
  createSeason: (titleId: string, body: Partial<Season> & { seasonNumber: number }) => data<Season>(`/media/titles/${titleId}/seasons`, send("POST", body)),
  updateSeason: (id: string, body: Partial<Omit<Season, "id">>) => data<Season>(`/media/seasons/${id}`, send("PATCH", body)),
  deleteSeason: (id: string) => data<Season>(`/media/seasons/${id}`, send("DELETE")),

  episodes: (seasonId: string) => data<Episode[]>(`/media/seasons/${seasonId}/episodes`),
  createEpisode: (seasonId: string, body: Partial<Episode> & { episodeNumber: number }) => data<Episode>(`/media/seasons/${seasonId}/episodes`, send("POST", body)),
  updateEpisode: (id: string, body: Partial<Omit<Episode, "id">>) => data<Episode>(`/media/episodes/${id}`, send("PATCH", body)),
  deleteEpisode: (id: string) => data<Episode>(`/media/episodes/${id}`, send("DELETE")),
  generateEpisodes: (seasonId: string, from: number, to: number) => data<{ count: number }>(`/media/seasons/${seasonId}/episodes/generate`, send("POST", { from, to })),
  shiftEpisodes: (seasonId: string, from: number, delta: number) => data<{ count: number }>(`/media/seasons/${seasonId}/episodes/shift`, send("POST", { from, delta })),
  scheduleEpisodes: (seasonId: string, from: number, startDate: string, intervalDays: number) =>
    data<{ count: number }>(`/media/seasons/${seasonId}/episodes/schedule`, send("POST", { from, startDate, intervalDays })),

  sources: (owner: SourceOwner) => data<Source[]>(`/media/${owner.kind}/${owner.id}/sources`),
  createSource: (owner: SourceOwner, body: { name: string; quality?: string | null }) => data<Source>(`/media/${owner.kind}/${owner.id}/sources`, send("POST", body)),
  updateSource: (id: string, body: { name?: string; quality?: string | null; enabled?: boolean }) => data<Source>(`/media/sources/${id}`, send("PATCH", body)),
  deleteSource: (id: string) => data<Source>(`/media/sources/${id}`, send("DELETE")),
  streams: (sourceId: string) => data<Stream[]>(`/media/sources/${sourceId}/streams`),
  addStream: (sourceId: string, body: { url: string; episodeId?: string | null; resolution?: string | null }) => data<Stream>(`/media/sources/${sourceId}/streams`, send("POST", body)),
  deleteStream: (id: string) => data<Stream>(`/media/streams/${id}`, send("DELETE")),
  paste: (sourceId: string, text: string, options: { createMissing: boolean; dryRun: boolean }) => data<PasteResult>(`/media/sources/${sourceId}/paste`, send("POST", { text, ...options })),

  people: (q: string, page: number) => paged<Person>(`/media/people${query({ q: q.trim() || undefined, page, limit: 20 })}`),
  createPerson: (body: Partial<Person> & { name: string }) => data<Person>("/media/people", send("POST", body)),
  updatePerson: (id: string, body: Partial<Omit<Person, "id">>) => data<Person>(`/media/people/${id}`, send("PATCH", body)),
  deletePerson: (id: string) => data<Person>(`/media/people/${id}`, send("DELETE")),

  credits: (titleId: string) => data<Credit[]>(`/media/titles/${titleId}/credits`),
  addCredit: (titleId: string, body: { personId: string; role: "cast" | "crew"; seasonId?: string | null; character?: string | null; job?: string | null }) =>
    data<Credit>(`/media/titles/${titleId}/credits`, send("POST", body)),
  deleteCredit: (id: string) => data<Credit>(`/media/credits/${id}`, send("DELETE")),

  images: (ownerType: ImageOwner, ownerId: string) => data<MediaImage[]>(`/media/images${query({ ownerType, ownerId })}`),
  addImage: (body: { ownerType: ImageOwner; ownerId: string; kind: ImageKind; url?: string; assetSha256?: string; assetName?: string }) => data<MediaImage>("/media/images", send("POST", body)),
  setPrimaryImage: (id: string) => data<MediaImage>(`/media/images/${id}`, send("PATCH", { isPrimary: true })),
  deleteImage: (id: string) => data<MediaImage>(`/media/images/${id}`, send("DELETE")),
  uploadImage: (file: File) => data<{ sha256: string; name: string }>(`/media/images/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
  }),

  externalIds: (titleId: string) => data<ExternalId[]>(`/media/external-ids${query({ ownerType: "title", ownerId: titleId })}`),
  addExternalId: (titleId: string, source: ExternalSource, externalId: string) =>
    data<ExternalId>("/media/external-ids", send("POST", {
      ownerType: "title",
      ownerId: String(titleId),
      source,
      externalId,
    })),
  deleteExternalId: (id: string) => data<ExternalId>(`/media/external-ids/${id}`, send("DELETE")),

  translations: (titleId: string) => data<Translation[]>(`/media/titles/${titleId}/translations`),
  putTranslation: (titleId: string, locale: string, body: TranslationInput) => data<Translation>(`/media/titles/${titleId}/translations/${encodeURIComponent(locale)}`, send("PUT", body)),
  deleteTranslation: (titleId: string, locale: string) => data<Translation>(`/media/titles/${titleId}/translations/${encodeURIComponent(locale)}`, send("DELETE")),

  rows: () => data<Row[]>("/media/rows"),
  createRow: (body: { name: string; kind: "manual" | "rule"; rule?: RowRule | null; titleIds?: string[]; onHome?: boolean }) => data<Row>("/media/rows", send("POST", body)),
  updateRow: (id: string, body: { name?: string; rule?: RowRule | null; titleIds?: string[]; onHome?: boolean }) => data<Row>(`/media/rows/${id}`, send("PATCH", body)),
  deleteRow: (id: string) => data<Row>(`/media/rows/${id}`, send("DELETE")),
  reorderRows: (ids: string[]) => data<unknown>("/media/rows/reorder", send("POST", { ids })),
  hero: () => data<{ titleIds: string[] }>("/media/hero").then(r => r.titleIds),
  setHero: (titleIds: string[]) => data<{ titleIds: string[] }>("/media/hero", send("PUT", { titleIds })),

  liveGroups: () => data<LiveGroup[]>("/media/live/groups"),
  createLiveGroup: (name: string) => data<LiveGroup>("/media/live/groups", send("POST", { name })),
  updateLiveGroup: (id: string, name: string) => data<LiveGroup>(`/media/live/groups/${id}`, send("PATCH", { name })),
  deleteLiveGroup: (id: string) => data<LiveGroup>(`/media/live/groups/${id}`, send("DELETE")),
  liveChannels: (groupId: string) => data<LiveChannel[]>(`/media/live/groups/${groupId}/channels`),
  createLiveChannel: (body: { groupId: string; name: string; number?: number | null; tvgId?: string | null; logo?: string | null; streams: LiveStream[] }) =>
    data<LiveChannel>("/media/live/channels", send("POST", body)),
  updateLiveChannel: (id: string, body: Partial<{ groupId: string; name: string; number: number | null; tvgId: string | null; logo: string | null; enabled: boolean; streams: LiveStream[] }>) =>
    data<LiveChannel>(`/media/live/channels/${id}`, send("PATCH", body)),
  deleteLiveChannel: (id: string) => data<LiveChannel>(`/media/live/channels/${id}`, send("DELETE")),
  importLive: (text: string, options: { replace: boolean; dryRun: boolean }) => data<ImportResult>("/media/live/import", send("POST", { text, ...options })),
  exportLive: () => data<{ text: string }>("/media/live/export"),
  epg: () => data<string[]>("/media/live/epg"),
  setEpg: (urls: string[]) => data<string[]>("/media/live/epg", send("PUT", { urls })),

};

/** Comma or newline separated text to a list, blanks dropped. */
export function splitList(text: string): string[] {
  return text.split(/[\n,，]/).map(s => s.trim()).filter(Boolean);
}

/** An input's text as a nullable field: blank is null. */
export function orNull(text: string): string | null {
  return text.trim() === ""
    ? null
    : text.trim();
}
