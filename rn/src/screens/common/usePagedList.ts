import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

export interface Page<T> {
  list: T[];
  page: number;
  /** 0 when the backend does not report it. */
  pagecount: number;
}

export type PageLoader<T> = (page: number) => Promise<Page<T>>;

export interface PagedList<T> {
  items: T[];
  loading: boolean;
  error?: Error;
  hasMore: boolean;
  /** Appends the next page; ignored while a page is loading or when there is none. */
  loadMore(): void;
  /** Starts over from page 1. */
  reload(): void;
}

interface Cursor {
  page: number;
  hasMore: boolean;
  busy: boolean;
}

interface State<T> {
  items: T[];
  loading: boolean;
  error?: Error;
  hasMore: boolean;
}

/** Whether another page follows `page`; an unknown pagecount (0) keeps going until an empty page. */
export function pageHasMore(page: number, result: Page<unknown>): boolean {
  return result.pagecount > 0 ? page < result.pagecount : result.list.length > 0;
}

/**
 * Pages through `loader` (SiteViewModel.categoryContent paging): page 1 on
 * mount and whenever `deps` change, responses of an older deps generation are
 * dropped.
 */
export function usePagedList<T>(loader: PageLoader<T>, deps: DependencyList): PagedList<T> {
  const [state, setState] = useState<State<T>>({ items: [], loading: true, hasMore: false });
  const loaderRef = useRef(loader);
  const generation = useRef(0);
  const cursor = useRef<Cursor>({ page: 0, hasMore: false, busy: false });

  const run = useCallback(async (gen: number, page: number, append: boolean) => {
    try {
      const result = await loaderRef.current(page);
      if (gen !== generation.current) return;
      const current = result.page || page;
      const hasMore = pageHasMore(current, result);
      cursor.current = { page: current, hasMore, busy: false };
      setState((prev) => ({
        items: append ? [...prev.items, ...result.list] : result.list,
        loading: false,
        hasMore,
      }));
    } catch (error) {
      if (gen !== generation.current) return;
      cursor.current = { ...cursor.current, busy: false };
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error : new Error(String(error)) }));
    }
  }, []);

  const reload = useCallback(() => {
    const gen = ++generation.current;
    cursor.current = { page: 0, hasMore: false, busy: true };
    setState({ items: [], loading: true, hasMore: false });
    void run(gen, 1, false);
  }, [run]);

  const loadMore = useCallback(() => {
    const { page, hasMore, busy } = cursor.current;
    if (busy || !hasMore) return;
    cursor.current = { page, hasMore, busy: true };
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    void run(generation.current, page + 1, true);
  }, [run]);

  // Declared before the reload effect so a deps change loads with the new loader.
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    reload();
    // Invalidates the pending response; the counter itself, not a rendered node.
    const counter = generation;
    return () => {
      counter.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, loadMore, reload };
}
