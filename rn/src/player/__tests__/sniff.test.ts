import type { SnifferModule, SnifferRequestEvent } from '../../../modules/sniffer';
import { normalizeRule, type Rule } from '../../core/types';
import { MSG_PARSE_FAILED, MSG_WEB_PARSE, PlaybackError } from '../resolve';
import { isVideoFormat, sniffMedia, sniffScripts, TIMEOUT_PARSE_WEB } from '../sniff';

const rule = (json: Record<string, unknown>): Rule => normalizeRule(json);

describe('isVideoFormat', () => {
  it.each([
    'https://cdn.example.com/hls/0123/index.m3u8',
    'https://cdn.example.com/hls/0123/index.m3u8?token=abc&t=1',
    'https://cdn.example.com/media/movie.mp4?sign=x',
    'http://cdn.example.com/media/movie.mkv',
    'https://cdn.example.com/live/stream.flv?auth=1',
    'https://cdn.example.com/dash/manifest.mpd',
    'https://v3.douyinvod.com/abc/video/tos/cn/tos-cn-ve-15/xyz',
    'rtmp://live.example.com/app/stream',
  ])('hits %s', (url) => {
    expect(isVideoFormat(url)).toBe(true);
  });

  it.each([
    'https://player.example.com/play/index.html',
    'https://jx.example.com/?url=https://cdn.example.com/hls/0123/index.m3u8',
    'https://jx.example.com/?v=https://cdn.example.com/hls/0123/index.m3u8',
    'https://a.co/x.m3u8',
    'https://cdn.example.com/static/app.js',
  ])('misses %s', (url) => {
    expect(isVideoFormat(url)).toBe(false);
  });

  it('hits a rule regex for a matching host, before the generic checks', () => {
    const rules = [rule({ name: 'r', hosts: ['play.example.com'], regex: ['/getvideo\\?id=\\d+'] })];
    expect(isVideoFormat('https://play.example.com/getvideo?id=12', rules)).toBe(true);
    expect(isVideoFormat('https://other.example.com/getvideo?id=12', rules)).toBe(false);
  });

  it('hits a rule regex given as a plain substring', () => {
    const rules = [rule({ hosts: ['play.example.com'], regex: ['.html?type=video'] })];
    expect(isVideoFormat('https://play.example.com/x.html?type=video', rules)).toBe(true);
  });

  it('misses a URL excluded by the rule, by substring or regex', () => {
    const rules = [rule({ hosts: ['cdn.example.com'], exclude: ['/ad/', 'preroll\\d+'] })];
    expect(isVideoFormat('https://cdn.example.com/ad/0123/index.m3u8', rules)).toBe(false);
    expect(isVideoFormat('https://cdn.example.com/preroll7/index.m3u8', rules)).toBe(false);
    expect(isVideoFormat('https://cdn.example.com/hls/0123/index.m3u8', rules)).toBe(true);
  });

  it('matches the rule host through the `url` query parameter', () => {
    const rules = [rule({ hosts: ['source.example.com'], regex: ['/api/stream'] })];
    const url = 'https://jx.example.com/api/stream?url=' + encodeURIComponent('https://source.example.com/vod/1');
    expect(isVideoFormat(url, rules)).toBe(true);
  });

  it('ignores invalid rule regexes', () => {
    const rules = [rule({ hosts: ['cdn.example.com'], regex: ['(['], exclude: ['(['] })];
    expect(isVideoFormat('https://cdn.example.com/hls/0123/index.m3u8', rules)).toBe(true);
  });
});

describe('sniffScripts', () => {
  const rules = [rule({ hosts: ['play.example.com'], script: ['a()', 'b()'] })];

  it('returns the rule scripts with the click script first', () => {
    expect(sniffScripts('https://play.example.com/v/1', rules, 'click()')).toEqual(['click()', 'a()', 'b()']);
  });

  it('does not duplicate a click script the rule already has', () => {
    expect(sniffScripts('https://play.example.com/v/1', rules, 'b()')).toEqual(['a()', 'b()']);
  });

  it('returns only the click script without a matching rule', () => {
    expect(sniffScripts('https://other.example.com/', rules, 'click()')).toEqual(['click()']);
    expect(sniffScripts('https://other.example.com/', rules)).toEqual([]);
  });
});

interface FakeNative extends SnifferModule {
  emit(event: Omit<SnifferRequestEvent, 'id'> & { id?: string }): void;
  start: jest.Mock;
  stop: jest.Mock;
  listeners: Set<(event: SnifferRequestEvent) => void>;
}

function fakeNative(supported = true): FakeNative {
  const listeners = new Set<(event: SnifferRequestEvent) => void>();
  let current = '';
  return {
    listeners,
    isSupported: () => supported,
    start: jest.fn(async (id: string) => {
      current = id;
    }),
    stop: jest.fn(async () => undefined),
    addRequestListener: (listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit: (event) => {
      for (const listener of [...listeners]) listener({ id: current, ...event });
    },
  };
}

const page = { url: 'https://share.example.com/share/abc', headers: { 'User-Agent': 'UA' } };
const M3U8 = 'https://cdn.example.com/hls/0123/index.m3u8';

describe('sniffMedia', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves with the first media request and its headers, then stops the session', async () => {
    const native = fakeNative();
    const promise = sniffMedia({ ...page, click: 'go()' }, { native, rules: [] });
    await Promise.resolve();
    const [id, url, headers, scripts, timeout] = native.start.mock.calls[0]!;
    expect([url, headers, scripts, timeout]).toEqual([page.url, page.headers, ['go()'], TIMEOUT_PARSE_WEB]);
    native.emit({ url: 'https://share.example.com/static/app.js', headers: {} });
    native.emit({ url: M3U8, headers: { Referer: 'https://share.example.com/', 'User-Agent': 'WebUA', Range: 'bytes=0-' } });
    native.emit({ url: 'https://cdn.example.com/other/0123/index.m3u8', headers: {} });
    await expect(promise).resolves.toEqual({ url: M3U8, headers: { Referer: 'https://share.example.com/', 'User-Agent': 'WebUA' }, subtitles: [] });
    expect(native.stop).toHaveBeenCalledWith(id);
    expect(native.listeners.size).toBe(0);
  });

  it('falls back to the page headers with Referer when the hit has none', async () => {
    const native = fakeNative();
    const promise = sniffMedia(page, { native });
    await Promise.resolve();
    native.emit({ url: M3U8, headers: {} });
    await expect(promise).resolves.toEqual({ url: M3U8, headers: { 'User-Agent': 'UA', Referer: page.url }, subtitles: [] });
  });

  it('ignores requests of other sessions', async () => {
    const native = fakeNative();
    const promise = sniffMedia(page, { native, timeout: 50 });
    await Promise.resolve();
    native.emit({ id: 'other', url: M3U8, headers: {} });
    await expect(promise).rejects.toEqual(new PlaybackError(MSG_PARSE_FAILED));
  });

  it('times out with MSG_PARSE_FAILED and stops the session', async () => {
    jest.useFakeTimers();
    const native = fakeNative();
    const promise = sniffMedia(page, { native });
    const assertion = expect(promise).rejects.toEqual(new PlaybackError(MSG_PARSE_FAILED));
    jest.advanceTimersByTime(TIMEOUT_PARSE_WEB);
    await assertion;
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.listeners.size).toBe(0);
  });

  it('stops the session when cancelled', async () => {
    const native = fakeNative();
    const controller = new AbortController();
    const promise = sniffMedia(page, { native, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(PlaybackError);
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects with MSG_WEB_PARSE when the native module is missing or unsupported', async () => {
    await expect(sniffMedia(page, { native: null })).rejects.toEqual(new PlaybackError(MSG_WEB_PARSE));
    const native = fakeNative(false);
    await expect(sniffMedia(page, { native })).rejects.toEqual(new PlaybackError(MSG_WEB_PARSE));
    expect(native.start).not.toHaveBeenCalled();
  });

  it('rejects with MSG_WEB_PARSE and stops when the native start fails', async () => {
    const native = fakeNative();
    native.start.mockRejectedValueOnce(new Error('no webview'));
    await expect(sniffMedia(page, { native })).rejects.toEqual(new PlaybackError(MSG_WEB_PARSE));
    expect(native.stop).toHaveBeenCalledTimes(1);
  });
});
