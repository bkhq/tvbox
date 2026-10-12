import type { RootStackParamList } from '../navigation/types';

/** Player route params: a VOD episode or a direct URL. */
export type PlayerParams = RootStackParamList['Player'];
export type VodPlayerParams = Extract<PlayerParams, { siteKey: string }>;
export type UrlPlayerParams = Extract<PlayerParams, { url: string }>;

export function isVodPlayerParams(params: PlayerParams | undefined): params is VodPlayerParams {
  return !!params && typeof (params as Partial<VodPlayerParams>).siteKey === 'string' && typeof (params as Partial<VodPlayerParams>).vodId === 'string';
}

export function isUrlPlayerParams(params: PlayerParams | undefined): params is UrlPlayerParams {
  return !!params && typeof (params as Partial<UrlPlayerParams>).url === 'string';
}
