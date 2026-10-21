import type { LanContext } from '../context';
import { LanCatalogError, type LanDetail, type LanPlayParams, type LanSearchSession } from '../ports';
import { badRequest, json, notFound, ok } from '../reply';
import type { LanEndpoint, LanResponse } from '../types';

/** A search nobody polled for this long is cancelled. */
export const SEARCH_IDLE_MS = 60_000;

interface Search {
  id: number;
  keyword: string;
  quick: boolean;
  session: LanSearchSession;
  timer?: ReturnType<typeof setTimeout>;
}

const unavailable = badRequest('catalog not available');

function catalogError(error: unknown): LanResponse | undefined {
  if (!(error instanceof LanCatalogError)) return undefined;
  return error.status === 404 ? notFound(error.message) : badRequest(error.message);
}

/**
 * /api/search: `word` starts a search (cancelling the previous one) and answers its first
 * snapshot with an id; `id` answers the current snapshot; `do=open` opens the Search screen on
 * the TV; no parameters answer the search history and hot words.
 */
export function searchApi(ctx: LanContext): LanEndpoint {
  let current: Search | undefined;
  let nextId = 0;

  const drop = () => {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    current.session.cancel();
    current = undefined;
  };

  const touch = (search: Search) => {
    if (search.timer) clearTimeout(search.timer);
    search.timer = setTimeout(() => {
      if (current === search) drop();
    }, SEARCH_IDLE_MS);
  };

  const answer = (search: Search) => {
    touch(search);
    return json({ id: search.id, keyword: search.keyword, quick: search.quick, ...search.session.snapshot() });
  };

  return async (_req, params) => {
    const word = (params.word ?? '').trim();
    if (params.do === 'open') {
      if (!word) return badRequest('word required');
      const navigator = ctx.ports().navigator;
      if (!navigator) return badRequest('navigator not available');
      navigator.search(word);
      return ok();
    }
    const catalog = ctx.ports().catalog;
    if (!catalog) return unavailable;
    if (word) {
      drop();
      const quick = params.quick === 'true';
      current = { id: ++nextId, keyword: word, quick, session: catalog.search(word, quick) };
      return answer(current);
    }
    if (params.id) {
      if (!current || String(current.id) !== params.id) return notFound('search not found');
      return answer(current);
    }
    return json(await catalog.words());
  };
}

export const detailApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) => {
    const catalog = ctx.ports().catalog;
    if (!catalog) return unavailable;
    if (!params.site || !params.id) return badRequest('site and id required');
    try {
      return json(await catalog.detail(params.site, params.id));
    } catch (error) {
      return catalogError(error) ?? Promise.reject(error);
    }
  };

/** The saved episode, else the first episode of the first line. */
function startOf(detail: LanDetail): Pick<LanPlayParams, 'flag' | 'episodeUrl' | 'position'> | undefined {
  if (detail.resume) {
    const { flag, episodeUrl, position } = detail.resume;
    return position > 0 ? { flag, episodeUrl, position } : { flag, episodeUrl };
  }
  const first = detail.flags.find((item) => item.episodes.length > 0);
  return first && { flag: first.flag, episodeUrl: first.episodes[0]!.url };
}

/** /api/play: plays `flag` + `url` of a site vod; without them resumes from the history or starts the first episode. */
export const playApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) => {
    const { navigator, catalog } = ctx.ports();
    if (!navigator) return badRequest('navigator not available');
    if (!params.site || !params.id) return badRequest('site and id required');
    let start: Pick<LanPlayParams, 'flag' | 'episodeUrl' | 'position'> | undefined;
    if (params.flag && params.url) {
      start = { flag: params.flag, episodeUrl: params.url };
      const position = Number(params.position);
      if (position > 0) start.position = position;
    } else {
      if (!catalog) return unavailable;
      try {
        start = startOf(await catalog.detail(params.site, params.id));
      } catch (error) {
        return catalogError(error) ?? Promise.reject(error);
      }
      if (!start) return notFound('no episodes');
    }
    navigator.play({ siteKey: params.site, vodId: params.id, ...start });
    return ok();
  };

export const libraryApi =
  (ctx: LanContext): LanEndpoint =>
  async () => {
    const catalog = ctx.ports().catalog;
    if (!catalog) return unavailable;
    const [history, keeps] = await Promise.all([catalog.history(), catalog.keeps()]);
    return json({ history, keeps });
  };
