import type { Credits, Playback } from "../contract";
import type { PlaybackDoc, SeasonDoc, TitleDoc } from "./documents";
import { countryName, languageName } from "./names";

/**
 * The Apple CMS view of the library (docs/plan/media-library.md, part 4),
 * derived from the same documents the native API serves so both show the
 * same thing. One item per movie (`m<id>`) and per playable season
 * (by season id); a series with more than one gets the season's name appended.
 */

export type Vod = Record<string, string>;

export interface CmsItemDoc {
  readonly vodId: string;
  readonly titleId: string;
  readonly seasonId: string | null;
  readonly groupOrder: number;
  /** For lists: no play lists. */
  readonly list: Vod;
  /** For `ac=detail&ids=`: with `vod_play_from` / `vod_play_url`. */
  readonly detail: Vod;
}

// `$`, `#` and `$$$` separate the play lists; a name must not carry them.
const clean = (s: string) => s.replace(/[$#]/g, " ").trim();
const names = (refs: readonly { name: string }[]) => refs.map(r => r.name).join(",");

/** `vod_play_from` / `vod_play_url` from what each episode (or the movie) plays. */
export function playLists(items: readonly { label: string; doc: Playback }[]): { from: string; url: string } {
  const sources = new Map<string, { name: string; parts: string[] }>();
  for (const { label, doc } of items) {
    for (const source of doc.sources) {
      let entry = sources.get(source.id);
      if (!entry) {
        entry = { name: clean(source.name) || "播放", parts: [] };
        sources.set(source.id, entry);
      }
      for (const stream of doc.episode ? source.streams.slice(0, 1) : source.streams)
        entry.parts.push(`${clean(doc.episode ? label : stream.resolution ?? label)}$${stream.url}`);
    }
  }
  // Flags name the play lists in the app, so they must differ.
  const seen = new Map<string, number>();
  const lists = [...sources.values()].map((s) => {
    const n = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, n);
    return { name: n > 1 ? `${s.name}${n}` : s.name, parts: s.parts };
  });
  return { from: lists.map(l => l.name).join("$$$"), url: lists.map(l => l.parts.join("#")).join("$$$") };
}

export function buildCmsItems(
  titles: readonly TitleDoc[],
  seasons: readonly SeasonDoc[],
  playback: readonly PlaybackDoc[],
  categoryName: ReadonlyMap<string, string>,
  genreName: ReadonlyMap<string, string>,
): CmsItemDoc[] {
  const playbackById = new Map(playback.map(p => [p.id, p.doc]));
  const out: CmsItemDoc[] = [];

  for (const t of titles) {
    const d = t.detail;
    const base = (credits: Credits, overview: string | null): Vod => ({
      type_id: t.categoryId,
      type_name: categoryName.get(t.categoryId) ?? t.categoryId,
      vod_area: d.countries.map(countryName).join(","),
      vod_lang: d.language ? languageName(d.language) : "",
      vod_class: t.genreIds.map(g => genreName.get(g) ?? g).join(","),
      vod_score: d.rating === null ? "" : String(d.rating),
      vod_time: t.updatedAt,
      vod_director: names(credits.directors),
      vod_actor: names(credits.cast),
      vod_content: overview ?? "",
    });

    if (t.type === "movie") {
      const play = playbackById.get(t.id);
      if (!play)
        continue;
      const list: Vod = { vod_id: t.id, vod_name: t.card.title, vod_pic: d.images.poster?.url ?? "", vod_remarks: t.card.badge ?? "", vod_year: t.year ? String(t.year) : "", ...base(d.credits, d.overview) };
      const lists = playLists([{ label: "正片", doc: play }]);
      out.push({ vodId: t.id, titleId: t.id, seasonId: null, groupOrder: 0, list, detail: { ...list, vod_play_from: lists.from, vod_play_url: lists.url } });
      continue;
    }

    const own = seasons.filter(s => s.titleId === t.id && s.detail.availableCount > 0).sort((a, b) => a.number - b.number);
    for (const s of own) {
      const sd = s.detail;
      const available = sd.episodes.filter(e => e.available);
      const last = Math.max(...available.map(e => e.number));
      const year = sd.airDate ? Number(sd.airDate.slice(0, 4)) || t.year : t.year;
      const list: Vod = {
        vod_id: s.id,
        vod_name: own.length > 1 ? `${t.card.title} ${sd.name}` : t.card.title,
        vod_pic: sd.images.poster?.url ?? "",
        vod_remarks: sd.status === "ended" && sd.availableCount >= sd.episodeCount ? `全 ${sd.episodeCount} 集` : `更新至第 ${last} 集`,
        vod_year: year ? String(year) : "",
        ...base(sd.credits, sd.overview),
      };
      const lists = playLists(available.flatMap((e) => {
        const doc = playbackById.get(e.id);
        return doc ? [{ label: e.type === "special" || e.name === `第 ${e.number} 集` ? e.name : `第 ${e.number} 集 ${e.name}`, doc }] : [];
      }));
      out.push({ vodId: s.id, titleId: t.id, seasonId: s.id, groupOrder: s.number, list, detail: { ...list, vod_play_from: lists.from, vod_play_url: lists.url } });
    }
  }
  return out;
}
