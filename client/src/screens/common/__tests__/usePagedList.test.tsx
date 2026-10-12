import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Page, type PagedList, type PageLoader, usePagedList } from '../usePagedList';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const page = (list: string[], number: number, pagecount: number): Page<string> => ({ list, page: number, pagecount });

function setup(loader: PageLoader<string>, initialDeps: unknown[] = ['a']) {
  const result: { current: PagedList<string> } = { current: undefined as unknown as PagedList<string> };
  function Harness({ deps, load }: { deps: unknown[]; load: PageLoader<string> }) {
    result.current = usePagedList(load, deps);
    return null;
  }
  let renderer!: ReactTestRenderer;
  const mount = async () => {
    await act(async () => {
      renderer = create(<Harness deps={initialDeps} load={loader} />);
    });
  };
  const update = async (deps: unknown[], load: PageLoader<string> = loader) => {
    await act(async () => renderer.update(<Harness deps={deps} load={load} />));
  };
  return { result, mount, update, unmount: () => act(async () => renderer.unmount()) };
}

describe('usePagedList', () => {
  it('loads the first page on mount', async () => {
    const loader = jest.fn(async (n: number) => page([`item${n}`], n, 3));
    const { result, mount, unmount } = setup(loader);
    await mount();
    expect(loader).toHaveBeenCalledWith(1);
    expect(result.current).toMatchObject({ items: ['item1'], loading: false, hasMore: true });
    expect(result.current.error).toBeUndefined();
    await unmount();
  });

  it('appends pages on loadMore and stops at pagecount', async () => {
    const loader = jest.fn(async (n: number) => page([`item${n}`], n, 2));
    const { result, mount, unmount } = setup(loader);
    await mount();
    await act(async () => result.current.loadMore());
    expect(loader).toHaveBeenLastCalledWith(2);
    expect(result.current).toMatchObject({ items: ['item1', 'item2'], hasMore: false });

    await act(async () => result.current.loadMore());
    expect(loader).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('keeps loading until an empty page when pagecount is 0', async () => {
    const loader = jest.fn(async (n: number) => page(n < 3 ? [`item${n}`] : [], 0, 0));
    const { result, mount, unmount } = setup(loader);
    await mount();
    await act(async () => result.current.loadMore());
    expect(result.current.hasMore).toBe(true);
    await act(async () => result.current.loadMore());
    expect(loader).toHaveBeenLastCalledWith(3);
    expect(result.current).toMatchObject({ items: ['item1', 'item2'], hasMore: false });
    await act(async () => result.current.loadMore());
    expect(loader).toHaveBeenCalledTimes(3);
    await unmount();
  });

  it('ignores loadMore while a page is loading', async () => {
    const second = deferred<Page<string>>();
    const loader = jest.fn((n: number) => (n === 1 ? Promise.resolve(page(['item1'], 1, 3)) : second.promise));
    const { result, mount, unmount } = setup(loader);
    await mount();
    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);
    await act(async () => second.resolve(page(['item2'], 2, 3)));
    expect(result.current).toMatchObject({ items: ['item1', 'item2'], loading: false });
    await unmount();
  });

  it('drops responses of the previous deps after a deps change', async () => {
    const stale = deferred<Page<string>>();
    const oldLoader = jest.fn(() => stale.promise);
    const newLoader = jest.fn(async (n: number) => page([`new${n}`], n, 1));
    const { result, mount, update, unmount } = setup(oldLoader, ['a']);
    await mount();
    await update(['b'], newLoader);
    expect(newLoader).toHaveBeenCalledWith(1);
    expect(result.current.items).toEqual(['new1']);

    await act(async () => stale.resolve(page(['old1'], 1, 1)));
    expect(result.current.items).toEqual(['new1']);
    await unmount();
  });

  it('exposes errors and recovers on reload', async () => {
    let fail = true;
    const loader = jest.fn(async (n: number) => {
      if (fail) throw new Error('boom');
      return page([`item${n}`], n, 1);
    });
    const { result, mount, unmount } = setup(loader);
    await mount();
    expect(result.current).toMatchObject({ items: [], loading: false, hasMore: false });
    expect(result.current.error?.message).toBe('boom');

    fail = false;
    await act(async () => result.current.reload());
    expect(result.current).toMatchObject({ items: ['item1'], loading: false });
    expect(result.current.error).toBeUndefined();
    await unmount();
  });
});
