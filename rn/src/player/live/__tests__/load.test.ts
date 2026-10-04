import type { FetchLike } from '../../../core/http';
import { normalizeLive } from '../../../core/types';
import { fixture } from '../__fixtures__/read';
import { liveHeaders, loadLive } from '../load';

function mockFetch(body: string, status = 200): jest.MockedFunction<FetchLike> {
  return jest.fn(async (url: string) => ({ ok: status < 400, status, url, text: async () => body }) as Response);
}

describe('loadLive', () => {
  it('downloads with the live headers, parses and prepends the keep group', async () => {
    const fetch = mockFetch(fixture('playlist.m3u'));
    const live = normalizeLive({ name: 'm3u', url: 'http://x/list.m3u', ua: 'UA', referer: 'http://r/', header: { 'X-K': 'v' }, timeout: 3 });
    const loaded = await loadLive(live, { fetch, keeps: ['浙江卫视', 'CCTV-1 综合'] });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://x/list.m3u');
    expect(init?.headers).toEqual({ 'X-K': 'v', 'User-Agent': 'UA', Referer: 'http://r/' });

    expect(loaded.groups.map((group) => group.name)).toEqual(['收藏', '央视', '卫视', '直播', 'VIP']);
    expect(loaded.groups[0]!.channel.map((c) => c.name)).toEqual(['CCTV-1 综合', '浙江卫视']);
    expect(loaded.epg).toBe('http://epg.example.com/e.xml.gz');
    expect(live.groups).toEqual([]);
  });

  it('copies keep channels instead of sharing their url lists', async () => {
    const loaded = await loadLive(normalizeLive({ name: 't', url: 'http://x' }), {
      fetch: mockFetch(fixture('channels.txt')),
      keeps: ['CCTV2'],
    });
    loaded.groups[0]!.channel[0]!.urls.push('http://extra');
    expect(loaded.groups[2]!.channel[1]!.urls).toEqual(['http://a.example.com/2.m3u8']);
  });

  it('decodes base64-wrapped lists with the config decoder', async () => {
    // base64 of "CCTV,http://a/1.m3u8"
    const body = 'abcdefgh**Q0NUVixodHRwOi8vYS8xLm0zdTg=';
    const loaded = await loadLive(normalizeLive({ name: 't', url: 'http://x' }), { fetch: mockFetch(body) });
    expect(loaded.groups[1]!.channel[0]!.urls).toEqual(['http://a/1.m3u8']);
  });

  it('uses inline groups without fetching and drops empty groups', async () => {
    const fetch = mockFetch('');
    const live = normalizeLive({
      name: 'json',
      groups: [
        { name: 'empty', channel: [] },
        { name: 'A', channel: [{ name: 'a', urls: ['http://a'] }] },
      ],
    });
    const loaded = await loadLive(live, { fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(loaded.groups.map((group) => group.name)).toEqual(['收藏', 'A']);
  });

  it('returns no groups (and no keep group) for an empty list', async () => {
    const loaded = await loadLive(normalizeLive({ name: 't', url: 'http://x' }), { fetch: mockFetch('  ') });
    expect(loaded.groups).toEqual([]);
  });

  it('rejects HTTP errors and spider sources', async () => {
    await expect(loadLive(normalizeLive({ name: 't', url: 'http://x' }), { fetch: mockFetch('', 404) })).rejects.toThrow('HTTP 404');
    await expect(loadLive(normalizeLive({ name: 't', api: 'csp_Live' }), { fetch: mockFetch('') })).rejects.toThrow('not supported');
  });
});

describe('liveHeaders', () => {
  it('adds ua / origin / referer to the header map', () => {
    expect(liveHeaders(normalizeLive({ origin: 'http://o' }))).toEqual({ Origin: 'http://o' });
  });
});
