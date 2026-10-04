import type { Filter } from '../../../core/types';
import { initialSelection, selectFilter, toExtend } from '../filterState';

const filters: Filter[] = [
  { key: 'year', name: '年份', init: '2024', value: [{ n: '全部', v: '' }, { n: '2024', v: '2024' }] },
  { key: 'area', name: '地区', init: '', value: [{ n: '全部', v: '' }, { n: '大陆', v: '大陆' }] },
  { key: 'sort', name: '排序', init: '', value: [{ n: '时间', v: 'time' }, { n: '热度', v: 'hits' }] },
  { key: 'empty', name: '空', init: '', value: [] },
];

describe('filterState', () => {
  it('starts at init or the first value', () => {
    expect(initialSelection(filters)).toEqual({ year: '2024', area: '', sort: 'time', empty: '' });
  });

  it('selects a value without mutating the previous selection', () => {
    const before = initialSelection(filters);
    const after = selectFilter(before, 'area', '大陆');
    expect(after).toMatchObject({ area: '大陆', year: '2024' });
    expect(before.area).toBe('');
  });

  it('builds extend without empty values', () => {
    const selection = selectFilter(initialSelection(filters), 'year', '');
    expect(toExtend(selection)).toEqual({ sort: 'time' });
    expect(toExtend({})).toEqual({});
  });
});
