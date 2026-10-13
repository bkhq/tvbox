import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Class, normalizeClass } from '../../../core/types';
import { setMainNavAvailability } from '../../../navigation/mainNav';
import { remainingClasses, resolveSections, useSectionAvailability } from '../sections';

jest.mock('../../../navigation/mainNav', () => ({ setMainNavAvailability: jest.fn() }));

const mockSet = jest.mocked(setMainNavAvailability);

const classes = (...names: string[]): Class[] =>
  names.map((name, index) => normalizeClass({ type_id: String(index + 1), type_name: name }));

const names = (sections: ReturnType<typeof resolveSections>) => ({
  series: sections.series?.type_name,
  movie: sections.movie?.type_name,
});

beforeEach(() => mockSet.mockClear());

describe('resolveSections', () => {
  it('matches exact (trimmed) names first', () => {
    const list = classes('动漫', '国产电视剧', ' 剧集 ', '电影解说', '电影');
    expect(names(resolveSections(list))).toEqual({ series: ' 剧集 ', movie: '电影' });
  });

  it('accepts each series alias', () => {
    expect(resolveSections(classes('电视剧')).series?.type_name).toBe('电视剧');
    expect(resolveSections(classes('连续剧')).series?.type_name).toBe('连续剧');
  });

  it('falls back to the first name containing a keyword', () => {
    const list = classes('综艺', '国产连续剧', '欧美剧集', '动作电影', '科幻电影');
    expect(names(resolveSections(list))).toEqual({ series: '国产连续剧', movie: '动作电影' });
  });

  it('returns nothing when no name matches', () => {
    expect(resolveSections(classes('综艺', '动漫'))).toEqual({});
    expect(resolveSections([])).toEqual({});
  });

  it('never uses one class for both sections', () => {
    expect(names(resolveSections(classes('电影电视剧')))).toEqual({ series: '电影电视剧', movie: undefined });
    expect(names(resolveSections(classes('电影电视剧', '电影')))).toEqual({ series: '电影电视剧', movie: '电影' });
    expect(names(resolveSections(classes('电影电视剧', '微电影')))).toEqual({ series: '电影电视剧', movie: '微电影' });
  });
});

describe('remainingClasses', () => {
  it('drops the classes used by a section and keeps the order', () => {
    const list = classes('综艺', '电影', '动漫', '电视剧');
    expect(remainingClasses(list, resolveSections(list)).map((item) => item.type_name)).toEqual(['综艺', '动漫']);
    expect(remainingClasses(list, {})).toEqual(list);
  });
});

describe('useSectionAvailability', () => {
  function Probe({ value }: { value: readonly Class[] | undefined }) {
    useSectionAvailability(value);
    return null;
  }

  async function render(value: readonly Class[] | undefined) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Probe, { value }));
    });
    return (next: readonly Class[] | undefined) =>
      act(async () => renderer.update(createElement(Probe, { value: next })));
  }

  it('leaves the store alone until classes are known', async () => {
    await render(undefined);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('publishes which tabs match and updates when classes change', async () => {
    const update = await render(classes('电影', '综艺'));
    expect(mockSet).toHaveBeenLastCalledWith({ series: false, movie: true });

    await update(classes('电视剧', '电影'));
    expect(mockSet).toHaveBeenLastCalledWith({ series: true, movie: true });

    mockSet.mockClear();
    await update(undefined);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('hides both tabs for a site without categories', async () => {
    await render([]);
    expect(mockSet).toHaveBeenLastCalledWith({ series: false, movie: false });
  });
});
