/**
 * CMS provider for type 0 (XML) and type 1 (JSON) sites, ported from the
 * non-spider branches of SiteApi.java and Result.fromType/fromXml/fromJson.
 * Playback resolution (sniffing, parsers) is left to the player.
 */

import { XMLParser } from 'fast-xml-parser';

import { getText, type RequestOptions } from '../http';
import { type Class, isObject, type JsonObject, normalizeResult, type Result, type Site, str } from '../types';
import type { ProviderContext, ProviderFactory, SiteProvider } from './types';

type Params = Record<string, string>;

/** SiteApi.call switches from GET query to POST form body above this ext length. */
const MAX_EXT_GET = 1000;

/** Sniffer.SNIFFER without config rules. */
const SNIFFER = /https?:\/\/[^\s]{12,}\.(?:m3u8|mp4|mkv|flv|mp3|m4a|aac|mpd)(?:\?.*)?|https?:\/\/.*?video\/tos[^\s]*|rtmp:[^\s]+/;

/** Sniffer.isVideoFormat minus per-host rules. */
export function isVideoFormat(url: string): boolean {
  if (url.includes('url=http') || url.includes('v=http') || url.includes('.html')) return false;
  return SNIFFER.test(url);
}

export function emptyResult(): Result {
  return normalizeResult({});
}

function encode(params: Params): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** OkHttp buildUrl: appends query parameters to the api URL. */
export function buildUrl(api: string, params: Params): string {
  const query = encode(params);
  if (query === '') return api;
  const hash = api.indexOf('#');
  const base = hash >= 0 ? api.slice(0, hash) : api;
  const fragment = hash >= 0 ? api.slice(hash) : '';
  const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
  return `${base}${separator}${query}${fragment}`;
}

// ---------------------------------------------------------------------------
// Parsing

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'ty' || name === 'video' || name === 'dd',
});

function xmlText(value: unknown): string {
  if (isObject(value)) return str(value['#text']);
  return str(value);
}

function xmlList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Vod with XML `<dl><dd flag="...">urls</dd></dl>` folded into vod_play_from / vod_play_url. */
function xmlVod(video: JsonObject): JsonObject {
  const dl = isObject(video.dl) ? video.dl : {};
  const flags = xmlList(dl.dd)
    .map((dd) => ({ flag: isObject(dd) ? str(dd['@_flag']) : '', urls: xmlText(dd) }))
    .filter((item) => item.flag !== '' || item.urls !== '');
  return {
    vod_id: xmlText(video.id),
    vod_name: xmlText(video.name),
    type_name: xmlText(video.type),
    vod_pic: xmlText(video.pic),
    vod_remarks: xmlText(video.note),
    vod_year: xmlText(video.year),
    vod_area: xmlText(video.area),
    vod_director: xmlText(video.director),
    vod_actor: xmlText(video.actor),
    vod_content: xmlText(video.des),
    vod_play_from: flags.map((item) => item.flag).join('$$$'),
    vod_play_url: flags.map((item) => item.urls).join('$$$'),
  };
}

/**
 * Result.fromXml: `<rss><class><ty id="">name</ty></class><list><video>...`.
 * Paging attributes on `<list>` (page, pagecount, pagesize, recordcount) are
 * read too. Malformed input yields an empty Result.
 */
export function parseXmlResult(text: string): Result {
  let doc: unknown;
  try {
    doc = xmlParser.parse(text);
  } catch {
    return emptyResult();
  }
  const rss = isObject(doc) && isObject(doc.rss) ? doc.rss : {};
  const classNode = isObject(rss.class) ? rss.class : {};
  const listNode = isObject(rss.list) ? rss.list : {};
  return normalizeResult({
    class: xmlList(classNode.ty).map((ty) => ({ type_id: isObject(ty) ? str(ty['@_id']) : '', type_name: xmlText(ty) })),
    list: xmlList(listNode.video).filter(isObject).map(xmlVod),
    page: listNode['@_page'],
    pagecount: listNode['@_pagecount'],
    limit: listNode['@_pagesize'],
    total: listNode['@_recordcount'],
  });
}

/** Result.fromJson: malformed input yields an empty Result. */
export function parseJsonResult(text: string): Result {
  try {
    const json: unknown = JSON.parse(text);
    return isObject(json) ? normalizeResult(json) : emptyResult();
  } catch {
    return emptyResult();
  }
}

export function parseResult(type: number, text: string): Result {
  return type === 0 ? parseXmlResult(text) : parseJsonResult(text);
}

/** SiteApi.setTypes: attach filters to classes, then order/filter by site.categories. */
export function applyTypes(site: Site, result: Result): Result {
  let types: Class[] = result.class.map((type) => {
    const filters = result.filters[type.type_id];
    return filters ? { ...type, filters } : type;
  });
  if (site.categories.length > 0) {
    const byName = new Map<string, Class>();
    for (const type of types) byName.set(type.type_name, type);
    const ordered = site.categories.map((name) => byName.get(name)).filter((type): type is Class => type !== undefined);
    if (ordered.length > 0) types = ordered;
  }
  return { ...result, class: types };
}

// ---------------------------------------------------------------------------
// Provider

function ac(type: number): string {
  return type === 0 ? 'videolist' : 'detail';
}

export class CmsProvider implements SiteProvider {
  constructor(
    readonly site: Site,
    private readonly ctx: ProviderContext = {},
  ) {}

  private options(): RequestOptions {
    return { headers: this.site.header, timeout: this.site.timeout, fetch: this.ctx.fetch };
  }

  /** Plain GET with query params (no `extend`), as used by home and fetchPic. */
  private get(params: Params): Promise<string> {
    return getText(buildUrl(this.site.api, params), this.options());
  }

  /** SiteApi.call: adds `extend`, POSTs a form body when the ext is too long for a URL. */
  private call(params: Params): Promise<string> {
    const { ext } = this.site;
    const all = ext === '' ? params : { ...params, extend: ext };
    if (ext.length <= MAX_EXT_GET) return this.get(all);
    return getText(this.site.api, {
      ...this.options(),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.site.header },
      body: encode(all),
    });
  }

  /** SiteApi.fetchPic: when the list lacks pictures, refetch it through the detail endpoint. */
  private async fetchPic(result: Result): Promise<Result> {
    if (result.list.length === 0 || result.list[0]?.vod_pic !== '') return result;
    const { categories } = this.site;
    const ids = result.list
      .filter((vod) => categories.length === 0 || categories.includes(vod.type_name))
      .map((vod) => vod.vod_id);
    if (ids.length === 0) return { ...result, list: [] };
    const text = await this.get({ ac: ac(this.site.type), ids: ids.join(',') });
    return { ...result, list: parseResult(this.site.type, text).list };
  }

  async home(_filter: boolean): Promise<Result> {
    const text = await this.get({});
    return applyTypes(this.site, await this.fetchPic(parseResult(this.site.type, text)));
  }

  /** CMS home already carries its list; there is no separate home video call. */
  async homeVideo(): Promise<Result> {
    return emptyResult();
  }

  async category(tid: string, page: string, _filter: boolean, extend: Record<string, string>): Promise<Result> {
    const params: Params = {};
    if (this.site.type === 1 && Object.keys(extend).length > 0) params.f = JSON.stringify(extend);
    params.ac = ac(this.site.type);
    params.t = tid;
    params.pg = page;
    return parseResult(this.site.type, await this.call(params));
  }

  async detail(ids: string[]): Promise<Result> {
    const text = await this.call({ ac: ac(this.site.type), ids: ids.join(',') });
    return parseResult(this.site.type, text);
  }

  async search(key: string, quick: boolean, page = '1'): Promise<Result> {
    const params: Params = { wd: key, quick: String(quick), extend: '' };
    if (page !== '1') params.pg = page;
    return this.fetchPic(parseResult(this.site.type, await this.call(params)));
  }

  /** The episode id is the play URL; parse = 1 unless it already looks like media and no playUrl prefix is set. */
  async player(flag: string, id: string, _vipFlags: string[]): Promise<Result> {
    const { header, playUrl, key } = this.site;
    return {
      ...emptyResult(),
      url: { values: [{ n: '', v: id }], position: 0 },
      key,
      flag,
      header: { ...header },
      playUrl,
      parse: isVideoFormat(id) && playUrl === '' ? 0 : 1,
    };
  }
}

export const cmsProviderFactory: ProviderFactory = {
  id: 'cms',
  match: (site) => site.type === 0 || site.type === 1,
  create: (site, ctx) => new CmsProvider(site, ctx),
};
