/**
 * Pasted play lists: `name$url` lines (or `#`-separated, the CMS form) lined
 * up with a season's episodes.
 */

export interface PastedLine {
  readonly name: string;
  readonly url: string;
}

export interface AlignEpisode {
  readonly id: string;
  readonly episodeNumber: number;
}

export interface Alignment {
  readonly matched: { readonly episodeId: string; readonly episodeNumber: number; readonly line: PastedLine }[];
  /** Lines whose number has no episode yet; `createMissing` adds one. */
  readonly missing: { readonly episodeNumber: number; readonly line: PastedLine }[];
  /** Lines that could not be placed: no number, a repeat, or no url. */
  readonly unmatched: { readonly line: PastedLine; readonly reason: "no-number" | "duplicate" | "no-episode" }[];
}

const MEDIA_URL = /^https?:\/\/\S+$/i;

/** Splits on newlines and `#`, then each item on its last `$` (a bare url is a line without a name). */
export function parsePasted(text: string): PastedLine[] {
  return text
    .split(/[\r\n#]+/)
    .map(item => item.trim())
    .filter(item => item !== "")
    .map((item) => {
      const cut = item.lastIndexOf("$");
      return cut < 0 ? { name: "", url: item } : { name: item.slice(0, cut).trim(), url: item.slice(cut + 1).trim() };
    })
    .filter(line => MEDIA_URL.test(line.url));
}

const NUMBER_PATTERNS = [
  /第\s*(\d+)\s*[集话話期回]/,
  /\b(?:s\d+\s*)?ep?\s*(\d+)\b/i,
  /^\D{0,3}(\d+)\D{0,3}$/,
];

/** The episode number a line's name carries: 第3集, S01E03, EP03, 03, 3集. */
export function episodeNumberOf(name: string): number | null {
  for (const pattern of NUMBER_PATTERNS) {
    const m = pattern.exec(name.trim());
    if (m)
      return Number(m[1]);
  }
  return null;
}

/**
 * By number when every named line carries one; otherwise, when no line
 * carries a number, by position against the episodes in order. A mix places
 * the numbered lines and reports the rest.
 */
export function alignLines(lines: readonly PastedLine[], episodes: readonly AlignEpisode[]): Alignment {
  const ordered = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const numbers = lines.map(l => episodeNumberOf(l.name));
  const matched: Alignment["matched"][number][] = [];
  const missing: Alignment["missing"][number][] = [];
  const unmatched: Alignment["unmatched"][number][] = [];

  if (numbers.every(n => n === null)) {
    lines.forEach((line, i) => {
      const episode = ordered[i];
      if (episode)
        matched.push({ episodeId: episode.id, episodeNumber: episode.episodeNumber, line });
      else
        unmatched.push({ line, reason: "no-episode" });
    });
    return { matched, missing, unmatched };
  }

  const byNumber = new Map(ordered.map(e => [e.episodeNumber, e]));
  const seen = new Set<number>();
  lines.forEach((line, i) => {
    const n = numbers[i]!;
    if (n === null) {
      unmatched.push({ line, reason: "no-number" });
      return;
    }
    if (seen.has(n)) {
      unmatched.push({ line, reason: "duplicate" });
      return;
    }
    seen.add(n);
    const episode = byNumber.get(n);
    if (episode)
      matched.push({ episodeId: episode.id, episodeNumber: n, line });
    else
      missing.push({ episodeNumber: n, line });
  });
  return { matched, missing, unmatched };
}

export type StreamFormat = "hls" | "mp4" | "dash";

/** From the url's extension; HLS when it says nothing. */
export function formatOf(url: string): StreamFormat {
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (path.endsWith(".mp4") || path.endsWith(".m4v") || path.endsWith(".mkv"))
    return "mp4";
  if (path.endsWith(".mpd"))
    return "dash";
  return "hls";
}
