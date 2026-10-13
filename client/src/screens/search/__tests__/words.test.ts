import { fetchHotWords, fetchSuggestWords, HOT_URL, parseWordList, SUGGEST_URL } from '../words';

describe('parseWordList', () => {
  it('reads title or name, dropping blanks and duplicates', () => {
    expect(
      parseWordList({ data: [{ title: '开心锤锤' }, { name: '功夫' }, { title: ' ' }, { name: '功夫' }, null, {}] }),
    ).toEqual(['开心锤锤', '功夫']);
  });

  it('returns nothing for other shapes', () => {
    expect(parseWordList(null)).toEqual([]);
    expect(parseWordList({ data: 'x' })).toEqual([]);
    expect(parseWordList('text')).toEqual([]);
  });
});

describe('word requests', () => {
  const answer = (body: unknown) =>
    jest.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body)));

  it('asks 360kan for hot words with its referer', async () => {
    const fetch = answer({ data: [{ title: '战狼2' }] });
    await expect(fetchHotWords({ fetch })).resolves.toEqual(['战狼2']);
    expect(fetch.mock.calls[0]![0]).toBe(HOT_URL);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('referer')).toBe('https://www.360kan.com/rank/general');
  });

  it('asks iQiyi for suggestions of the encoded text', async () => {
    const fetch = answer({ data: [{ name: '功夫女足' }] });
    await expect(fetchSuggestWords('功夫 女', { fetch })).resolves.toEqual(['功夫女足']);
    expect(fetch.mock.calls[0]![0]).toBe(`${SUGGEST_URL}%E5%8A%9F%E5%A4%AB%20%E5%A5%B3`);
  });
});
