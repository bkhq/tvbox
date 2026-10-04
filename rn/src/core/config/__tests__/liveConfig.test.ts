import type { FetchLike } from '../../http';
import { loadLiveConfig, nameFromUrl, parseLiveConfig } from '../liveConfig';

const LIVE_JSON = JSON.stringify({
  spider: './live.jar',
  lives: [
    { name: 'A', url: './a.m3u', header: '{"Referer":"https://r.example.com/"}' },
    { name: 'B', api: 'csp_Live', ext: ['x'] },
    { name: 'A', url: 'https://dup.example.com/a.m3u' },
  ],
  rules: [{ name: 'r', hosts: ['h'] }],
  ads: ['ad.example.com'],
  hosts: ['a=b'],
});

describe('parseLiveConfig', () => {
  it('parses lives from a JSON live config', () => {
    const config = parseLiveConfig(LIVE_JSON, 'https://live.example.com/tv/live.json');
    expect(config.lives.map((live) => live.name)).toEqual(['A', 'B']);
    expect(config.lives[0]).toMatchObject({
      url: 'https://live.example.com/tv/a.m3u',
      header: { Referer: 'https://r.example.com/' },
      timeout: 15000,
    });
    expect(config.lives[1]?.ext).toBe('["x"]');
    expect(config.home?.name).toBe('A');
    expect(config.rules).toEqual([{ name: 'r', hosts: ['h'], regex: [], script: [], exclude: [] }]);
    expect(config.ads).toEqual(['ad.example.com']);
    expect(config.hosts).toEqual(['a=b']);
  });

  it('honours the saved home name', () => {
    expect(parseLiveConfig(LIVE_JSON, 'https://l/x.json', { home: 'B' }).home?.name).toBe('B');
    expect(parseLiveConfig(LIVE_JSON, 'https://l/x.json', { home: 'gone' }).home?.name).toBe('A');
  });

  it('treats non-JSON text as a single channel-list source', () => {
    const config = parseLiveConfig('#EXTM3U\n#EXTINF:-1,CCTV\nhttp://x/1.m3u8', 'https://live.example.com/tv/iptv.m3u?x=1');
    expect(config.lives).toHaveLength(1);
    expect(config.home).toMatchObject({ name: 'iptv.m3u', url: 'https://live.example.com/tv/iptv.m3u?x=1' });
  });
});

describe('nameFromUrl', () => {
  it('uses the last path segment, then the host', () => {
    expect(nameFromUrl('https://h.example.com/a/b%20c.txt?q')).toBe('b c.txt');
    expect(nameFromUrl('https://H.example.com:8080/')).toBe('h.example.com');
    expect(nameFromUrl('plain')).toBe('plain');
  });
});

describe('loadLiveConfig', () => {
  it('follows a depot and returns text sources as-is', async () => {
    const fetch: FetchLike = jest.fn(async (url: string) => {
      const body = url === 'https://d/' ? '{"urls":[{"url":"https://l/tv.txt","name":"TV"}]}' : 'CCTV,#genre#\nCCTV1,http://x';
      return { ok: true, status: 200, url, text: async () => body } as Response;
    });
    const config = await loadLiveConfig('https://d/', {}, { fetch });
    expect(config.url).toBe('https://l/tv.txt');
    expect(config.lives.map((live) => live.name)).toEqual(['tv.txt']);
  });
});
