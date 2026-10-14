import { displayRemarks } from '../remarks';

describe('displayRemarks', () => {
  it('hides a zero score', () => {
    expect(displayRemarks('评分：0')).toBeUndefined();
    expect(displayRemarks('评分:0')).toBeUndefined();
    expect(displayRemarks('评分： 0.0')).toBeUndefined();
    expect(displayRemarks(' 评分：0 ')).toBeUndefined();
  });

  it('hides empty values', () => {
    expect(displayRemarks('')).toBeUndefined();
    expect(displayRemarks(undefined)).toBeUndefined();
    expect(displayRemarks('  \n')).toBeUndefined();
  });

  it('keeps other remarks, trimmed', () => {
    expect(displayRemarks('评分：8.5')).toBe('评分：8.5');
    expect(displayRemarks('更新至12集')).toBe('更新至12集');
    expect(displayRemarks(' HD ')).toBe('HD');
  });
});
