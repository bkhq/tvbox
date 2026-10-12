/// <reference types="node" />
/**
 * JS spider local proxy: Spider.proxy1 result mapping, JsSpiderProvider.proxy
 * through NodeSpiderRuntime, the recent spider and the getPort/getProxy
 * host APIs.
 */

import vm from 'node:vm';

import { parseSite } from '../../core/config/vodConfig';
import type { FetchLike } from '../../core/http';
import { NodeSpiderRuntime } from '../__testutils__/nodeRuntime';
import {
  getRecentJsSpider,
  JsSpiderProvider,
  parseSpiderProxy,
  PRELUDE,
  setSpiderProxy,
  setSpiderRuntime,
  spiderProxyScript,
} from '..';

const PROXY_SPIDER = `
export default {
    async init() {},
    async home() {
        return { class: [{ type_id: '1', type_name: getProxy(true) }] };
    },
    async proxy(params) {
        if (params.what === 'text') return [200, 'text/plain', 'echo:' + params.url, { 'X-A': 'b' }];
        if (params.what === 'b64') return [206, 'image/png', 'data:image/png;base64,iVBORw==', JSON.stringify({ 'X-B': 'c' }), 1];
        if (params.what === 'bytes') return [200, 'application/octet-stream', [104, 105, -1]];
        if (params.what === 'urls') return [200, 'text/plain', getProxy(true) + ' ' + getProxy(false) + ' ' + getPort()];
        if (params.what === 'bad') return 'nope';
        return [999, '', ''];
    },
};
`;

const fetchSpider = jest.fn(async (url: string) => ({ ok: true, status: 200, url, text: async () => PROXY_SPIDER }) as Response) as jest.Mock &
  FetchLike;

function provider(key = 'js', runtime = new NodeSpiderRuntime()) {
  return new JsSpiderProvider(parseSite({ key, name: key, type: 3, api: `https://s.example.com/${key}.js` }), { fetch: fetchSpider }, runtime);
}

beforeEach(() => {
  setSpiderRuntime(new NodeSpiderRuntime());
});

afterEach(() => {
  setSpiderRuntime(undefined);
  setSpiderProxy(-1);
});

describe('parseSpiderProxy', () => {
  it('maps [code, mime, text, headers] and adds Content-Type', () => {
    expect(parseSpiderProxy(JSON.stringify([200, 'text/html', '<p>', { 'X-A': 'b', N: 1 }]))).toEqual({
      status: 200,
      headers: { 'Content-Type': 'text/html', 'X-A': 'b', N: '1' },
      body: '<p>',
      bodyEncoding: 'utf8',
    });
  });

  it('passes base64 bodies through (data URL prefix dropped) and encodes byte arrays', () => {
    expect(parseSpiderProxy(JSON.stringify([200, 'image/png', 'data:image/png;base64,AAEC', '{"X":"y"}', 1]))).toMatchObject({
      headers: { 'Content-Type': 'image/png', X: 'y' },
      body: 'AAEC',
      bodyEncoding: 'base64',
    });
    expect(parseSpiderProxy(JSON.stringify([200, 'a/b', 'AAEC', null, 1]))).toMatchObject({ body: 'AAEC', bodyEncoding: 'base64' });
    expect(parseSpiderProxy(JSON.stringify([200, 'a/b', [0, 1, 2, 255, -2]]))).toMatchObject({ body: 'AAEC//4=', bodyEncoding: 'base64' });
    expect(parseSpiderProxy(JSON.stringify([200, 'a/b', { 0: 104, 1: 105 }]))).toMatchObject({ body: 'aGk=', bodyEncoding: 'base64' });
  });

  it('treats out-of-range codes as 500 and non-arrays as invalid', () => {
    expect(parseSpiderProxy(JSON.stringify([42, '', '']))).toEqual({ status: 500, headers: {}, body: '', bodyEncoding: 'utf8' });
    expect(parseSpiderProxy('"text"')).toBeNull();
    expect(parseSpiderProxy('null')).toBeNull();
    expect(parseSpiderProxy('{')).toBeNull();
  });
});

describe('JsSpiderProvider.proxy', () => {
  it('calls the spider proxy with the params and maps the answer', async () => {
    const spider = provider();
    expect(await spider.proxy({ what: 'text', url: 'u' })).toEqual({
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'X-A': 'b' },
      body: 'echo:u',
      bodyEncoding: 'utf8',
    });
    expect(await spider.proxy({ what: 'b64' })).toEqual({
      status: 206,
      headers: { 'Content-Type': 'image/png', 'X-B': 'c' },
      body: 'iVBORw==',
      bodyEncoding: 'base64',
    });
    expect(await spider.proxy({ what: 'bytes' })).toMatchObject({ body: 'aGn/', bodyEncoding: 'base64' });
    expect(await spider.proxy({ what: 'bad' })).toBeNull();
    expect((await spider.proxy({}))?.status).toBe(500);
  });

  it('getPort/getProxy follow setSpiderProxy, also after the spider has loaded', async () => {
    const spider = provider();
    expect((await spider.proxy({ what: 'urls' }))?.body).toBe('http://127.0.0.1:-1/proxy?do=js http://127.0.0.1:-1/proxy?do=js -1');
    setSpiderProxy(9978, () => '192.168.1.5');
    expect((await spider.proxy({ what: 'urls' }))?.body).toBe('http://127.0.0.1:9978/proxy?do=js http://192.168.1.5:9978/proxy?do=js 9978');
    expect((await spider.home(false)).class[0]?.type_name).toBe('http://127.0.0.1:9978/proxy?do=js');
  });

  it('the recent spider is the last one that ran a call; proxy calls and destroy update it', async () => {
    const a = provider('a');
    const b = provider('b');
    await a.home(false);
    expect(getRecentJsSpider()).toBe(a);
    await b.proxy({ what: 'text' });
    expect(getRecentJsSpider()).toBe(a);
    await b.home(false);
    expect(getRecentJsSpider()).toBe(b);
    await b.destroy();
    expect(getRecentJsSpider()).toBeUndefined();
    await a.destroy();
  });
});

describe('prelude getPort/getProxy', () => {
  function context() {
    const ctx = vm.createContext({ __host_http: jest.fn(), __host_local_get: jest.fn(), __host_local_set: jest.fn(), __host_local_delete: jest.fn(), __host_log: jest.fn() });
    vm.runInContext(PRELUDE, ctx);
    return (code: string) => vm.runInContext(code, ctx) as unknown;
  }

  it('defaults to port -1 on loopback', () => {
    const run = context();
    expect(run('getPort()')).toBe(-1);
    expect(run('getProxy(false)')).toBe('http://127.0.0.1:-1/proxy?do=js');
  });

  it('reads the state spiderProxyScript publishes', () => {
    const run = context();
    setSpiderProxy(9980, () => '10.0.0.2');
    run(spiderProxyScript());
    expect(run('getPort()')).toBe(9980);
    expect(run('getProxy(true)')).toBe('http://127.0.0.1:9980/proxy?do=js');
    expect(run('getProxy(false)')).toBe('http://10.0.0.2:9980/proxy?do=js');
  });

  it('falls back to loopback when the LAN address is unknown', () => {
    setSpiderProxy(9978, () => {
      throw new Error('no network');
    });
    expect(spiderProxyScript()).toBe('globalThis.__spider_proxy = {"port":9978,"host":"127.0.0.1"};');
  });
});
