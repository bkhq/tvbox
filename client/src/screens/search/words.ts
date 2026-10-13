import { getJson, type RequestOptions } from '../../core/http';

/** SearchActivity.getHot: 360kan's general ranking. */
export const HOT_URL = 'https://api.web.360kan.com/v1/rank?cat=1';
const HOT_REFERER = 'https://www.360kan.com/rank/general';
/** SearchActivity.getSuggest: iQiyi's completion for the typed text. */
export const SUGGEST_URL = 'https://suggest.video.iqiyi.com/?if=mobile&key=';

/** Titles of a `{ data: [{ title | name }] }` answer (Word.java), without blanks and duplicates. */
export function parseWordList(value: unknown): string[] {
  const data = (value as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const titles = data.map((item: { title?: unknown; name?: unknown } | null) => item?.title ?? item?.name);
  return [...new Set(titles.filter((title): title is string => typeof title === 'string' && title.trim() !== ''))];
}

export async function fetchHotWords(options?: RequestOptions): Promise<string[]> {
  return parseWordList(await getJson(HOT_URL, { ...options, headers: { Referer: HOT_REFERER } }));
}

export async function fetchSuggestWords(text: string, options?: RequestOptions): Promise<string[]> {
  return parseWordList(await getJson(SUGGEST_URL + encodeURIComponent(text), options));
}
