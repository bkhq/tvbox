import { addRequestInterceptor, type FetchLike, getJson, getText, mergeHeaders, request } from '../http';

function okFetch(body = 'ok'): jest.Mock & FetchLike {
  return jest.fn(async (url: string) => ({ ok: true, status: 200, url, text: async () => body }) as Response);
}

describe('mergeHeaders', () => {
  it('merges case-insensitively with later values winning', () => {
    expect(mergeHeaders({ 'User-Agent': 'a', Accept: '*/*' }, undefined, { 'user-agent': 'b' })).toEqual({
      Accept: '*/*',
      'user-agent': 'b',
    });
  });
});

describe('request interceptors', () => {
  it('inject headers for matching hosts and can be removed', async () => {
    const fetch = okFetch();
    const remove = addRequestInterceptor((url, init) =>
      new URL(url).host === 'server.local:9978'
        ? { ...init, headers: mergeHeaders(init.headers, { Authorization: 'Bearer t' }) }
        : init,
    );

    await request('http://server.local:9978/api', { headers: { Accept: 'text/plain' }, fetch });
    await request('https://other.example.com/', { fetch });
    remove();
    await request('http://server.local:9978/api', { fetch });

    const headersOf = (call: number) => (fetch.mock.calls[call]?.[1] as RequestInit).headers;
    expect(headersOf(0)).toEqual({ Accept: 'text/plain', Authorization: 'Bearer t' });
    expect(headersOf(1)).toEqual({});
    expect(headersOf(2)).toEqual({});
  });
});

describe('helpers', () => {
  it('read text and JSON', async () => {
    await expect(getText('https://a/', { fetch: okFetch('hello') })).resolves.toBe('hello');
    await expect(getJson('https://a/', { fetch: okFetch('{"a":1}') })).resolves.toEqual({ a: 1 });
  });

  it('throws on non-2xx responses', async () => {
    const fetch: FetchLike = async (url) => ({ ok: false, status: 500, url, text: async () => '' }) as Response;
    await expect(getText('https://a/', { fetch })).rejects.toThrow('HTTP 500: https://a/');
  });

  it('aborts after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      const pending = request('https://slow/', { fetch, timeout: 1000 });
      jest.advanceTimersByTime(1000);
      await expect(pending).rejects.toThrow('aborted');
    } finally {
      jest.useRealTimers();
    }
  });
});
