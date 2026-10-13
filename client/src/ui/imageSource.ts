import type { ImageURISource } from 'react-native';

type ImageSource = ImageURISource | ImageURISource[];

const OPTIONS = ['@Headers=', '@Cookie=', '@Referer=', '@User-Agent='] as const;

/** Value of `option` up to the next '@', the way the Java app's ImgUtil reads it. */
function optionValue(url: string, option: string): string | undefined {
  const start = url.indexOf(option);
  return start < 0 ? undefined : url.slice(start + option.length).split('@')[0];
}

function jsonHeaders(text: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  } catch {
    return {};
  }
}

/**
 * Image source for a TVBox picture url. Sources append request headers to the url
 * (`pic@Referer=...@User-Agent=...`, `@Cookie=`, `@Headers={json}`); they are split off here
 * because image hosts such as Douban refuse requests without them.
 */
export function imageSource(url: string | undefined): ImageSource | undefined {
  const text = url?.trim();
  if (!text) return undefined;
  if (text.startsWith('data:')) return { uri: text };
  const cut = Math.min(...OPTIONS.map((option) => text.indexOf(option)).filter((index) => index >= 0));
  if (!Number.isFinite(cut)) return { uri: text };
  const headers: Record<string, string> = {};
  const json = optionValue(text, '@Headers=');
  if (json !== undefined) Object.assign(headers, jsonHeaders(json));
  const cookie = optionValue(text, '@Cookie=');
  if (cookie !== undefined) headers.Cookie = cookie;
  const referer = optionValue(text, '@Referer=');
  if (referer !== undefined) headers.Referer = referer;
  const agent = optionValue(text, '@User-Agent=');
  if (agent !== undefined) headers['User-Agent'] = agent;
  // An array: React Native's Android Image drops `headers` from a single object source.
  return [{ uri: text.slice(0, cut), headers }];
}
