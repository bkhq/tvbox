/// <reference types="node" />
/**
 * Prelude helpers evaluated in a bare node `vm` context with stub __host_*
 * functions; the pd helpers run through NodeSpiderRuntime because they are
 * an ES module importing the bundled cheerio.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { LIB_DIR, NodeSpiderRuntime } from '../__testutils__/nodeRuntime';
import { PARSER_FILENAME, PARSER_MODULE, PRELUDE, spiderEntry, usesCrypto, usesParser } from '../prelude';

interface Host {
  http: jest.Mock<string, [string, string]>;
  get: jest.Mock<string, [string, string]>;
  set: jest.Mock<void, [string, string, string]>;
  del: jest.Mock<void, [string, string]>;
  log: jest.Mock<void, [string, string]>;
}

function setup(response: unknown = { code: 200, headers: { 'Content-Type': 'text/html' }, content: 'body' }) {
  const host: Host = {
    http: jest.fn((_url: string, _options: string) => (typeof response === 'string' ? response : JSON.stringify(response))),
    get: jest.fn((_rule: string, _key: string) => 'stored'),
    set: jest.fn(),
    del: jest.fn(),
    log: jest.fn(),
  };
  const context = vm.createContext({
    __host_http: host.http,
    __host_local_get: host.get,
    __host_local_set: host.set,
    __host_local_delete: host.del,
    __host_log: host.log,
  });
  vm.runInContext(PRELUDE, context);
  const run = <T = unknown>(code: string): T => vm.runInContext(code, context) as T;
  /** Options JSON the host received on its last call. */
  const sent = () => JSON.parse(host.http.mock.calls.at(-1)?.[1] ?? '{}') as Record<string, unknown>;
  return { host, context, run, sent };
}

describe('http helpers', () => {
  it('req is synchronous and forwards the options as JSON', () => {
    const { host, run, sent } = setup();
    const res = run<{ code: number; content: string }>(
      "req('https://a.example.com/x', { method: 'post', postType: 'form', data: { a: 1 }, headers: { Referer: 'r' }, timeout: 3000, redirect: 0 })",
    );
    expect(res.code).toBe(200);
    expect(res.content).toBe('body');
    expect(host.http.mock.calls[0]?.[0]).toBe('https://a.example.com/x');
    expect(sent()).toEqual({ async: false, method: 'post', postType: 'form', data: { a: 1 }, headers: { Referer: 'r' }, timeout: 3000, redirect: 0 });
  });

  it('maps buffer 1 to signed bytes and 3 to a Uint8Array, asking the host for base64', () => {
    const { run, sent } = setup({ code: 200, headers: {}, content: Buffer.from([1, 200, 255]).toString('base64') });
    expect(run('JSON.stringify(req("u", { buffer: 1 }).content)')).toBe('[1,-56,-1]');
    expect(sent().buffer).toBe(2);
    expect(run('Array.from(req("u", { buffer: 3 }).content)')).toEqual([1, 200, 255]);
    expect(run('req("u", { buffer: 3 }).content instanceof Uint8Array')).toBe(true);
    expect(run('req("u", { buffer: 2 }).content')).toBe('Acj/');
    expect(sent().buffer).toBe(2);
    run('req("u", {})');
    expect(sent().buffer).toBeUndefined();
  });

  it('returns the error shape when the host fails', () => {
    const { run } = setup('not json');
    expect(run('JSON.stringify(req("u", { buffer: 1 }))')).toBe('{"code":"","headers":{},"content":""}');
  });

  it('http is async and _http calls complete without forwarding it', async () => {
    const { run, sent } = setup();
    const res = await run<Promise<{ content: string }>>('http("u", { headers: { a: "b" } })');
    expect(res.content).toBe('body');
    expect(sent()).toEqual({ headers: { a: 'b' } });
    const completed = await run<Promise<{ content: string }>>('new Promise((resolve) => _http("u", { complete: resolve }))');
    expect(completed.content).toBe('body');
    expect(run('_http("u", { complete() {} })')).toBeNull();
  });
});

describe('local, console and aliases', () => {
  it('local maps onto __host_local_* with string arguments', () => {
    const { host, run } = setup();
    expect(run("local.get('rule', 'k')")).toBe('stored');
    run("local.set('rule', 'k', 12)");
    run("local.delete(null, 'k')");
    expect(host.get).toHaveBeenCalledWith('rule', 'k');
    expect(host.set).toHaveBeenCalledWith('rule', 'k', '12');
    expect(host.del).toHaveBeenCalledWith('', 'k');
  });

  it('console formats its arguments for __host_log', () => {
    const { host, run } = setup();
    run("console.log('a', 1, { b: 2 }); console.error('bad')");
    expect(host.log.mock.calls).toEqual([
      ['log', 'a 1 {"b":2}'],
      ['error', 'bad'],
    ]);
  });

  it('global, window and self alias globalThis', () => {
    const { run } = setup();
    expect(run('global === globalThis && window === globalThis && self === globalThis')).toBe(true);
  });
});

describe('timers', () => {
  it('__drainTimers runs due timers in order and reports the next delay', () => {
    const { run } = setup();
    run(`
      globalThis.order = [];
      setTimeout(() => order.push('b'), 0);
      setTimeout(() => order.push('a'), -5);
      globalThis.cancelled = setTimeout(() => order.push('x'), 0);
      setTimeout(() => order.push('later'), 60000);
      clearTimeout(cancelled);
    `);
    const next = run<number>('__drainTimers()');
    expect(run('order.join()')).toBe('b,a');
    expect(next).toBeGreaterThan(59000);
    expect(next).toBeLessThanOrEqual(60000);
    run('clearTimeout(4)');
    expect(run('__drainTimers()')).toBe(-1);
  });

  it('a throwing timer callback is logged and does not stop the others', () => {
    const { host, run } = setup();
    run("globalThis.ran = false; setTimeout(() => { throw new Error('t') }); setTimeout(() => { ran = true })");
    expect(run('__drainTimers()')).toBe(-1);
    expect(run('ran')).toBe(true);
    expect(host.log).toHaveBeenCalledWith('error', expect.stringContaining('setTimeout callback failed'));
  });
});

describe('joinUrl (UriUtil.resolve)', () => {
  const { run } = setup();
  const join = (base: string, ref: string) => run<string>(`joinUrl(${JSON.stringify(base)}, ${JSON.stringify(ref)})`);

  it.each([
    ['https://a.com/b/c/d?q', 'g', 'https://a.com/b/c/g'],
    ['https://a.com/b/c/d?q', './g/', 'https://a.com/b/c/g/'],
    ['https://a.com/b/c/d?q', '/g', 'https://a.com/g'],
    ['https://a.com/b/c/d?q', '//h.com/g', 'https://h.com/g'],
    ['https://a.com/b/c/d?q', '?y', 'https://a.com/b/c/d?y'],
    ['https://a.com/b/c/d?q#f', '#s', 'https://a.com/b/c/d?q#s'],
    ['https://a.com/b/c/d', '../../g', 'https://a.com/g'],
    ['https://a.com/b/c/d', '../../../g', 'https://a.com/g'],
    ['https://a.com', 'g', 'https://a.com/g'],
    ['https://a.com/b', 'http://x.com/./y/../z', 'http://x.com/z'],
    ['https://a.com/b', '', 'https://a.com/b'],
  ])('%s + %s', (base, ref, expected) => {
    expect(join(base, ref)).toBe(expected);
  });
});

describe('md5X / aesX', () => {
  const { host, context, run } = setup();
  vm.runInContext(fs.readFileSync(path.join(LIB_DIR, 'crypto-js.js'), 'utf8'), context);
  const call = (code: string) => run<string>(code);

  function nodeAes(algorithm: string, key: Buffer, iv: Buffer | null, input: Buffer, encrypt: boolean): Buffer {
    const cipher = encrypt ? crypto.createCipheriv(algorithm, key, iv) : crypto.createDecipheriv(algorithm, key, iv);
    return Buffer.concat([cipher.update(input), cipher.final()]);
  }

  it('md5X is the lowercase hex MD5 of the UTF-8 text', () => {
    expect(call("md5X('影视abc')")).toBe(crypto.createHash('md5').update('影视abc').digest('hex'));
  });

  it('aesX CBC encrypts / decrypts with base64 in and out', () => {
    const key = Buffer.from('0123456789abcdef');
    const expected = nodeAes('aes-128-cbc', key, key, Buffer.from('hello 世界'), true).toString('base64');
    expect(call("aesX('AES/CBC/PKCS5', true, 'hello 世界', false, '0123456789abcdef', '0123456789abcdef', true)")).toBe(expected);
    const urlSafe = expected.replace(/\//g, '_').replace(/\+/g, '-');
    expect(call(`aesX('AES/CBC/PKCS5', false, '${urlSafe}', true, '0123456789abcdef', '0123456789abcdef', false)`)).toBe('hello 世界');
  });

  it('aesX zero-pads short keys and ivs; ECB without iv', () => {
    const key = Buffer.alloc(16);
    key.write('short');
    const iv = Buffer.alloc(16);
    iv.write('iv');
    expect(call("aesX('AES/CBC/PKCS5', true, 'data', false, 'short', 'iv', true)")).toBe(
      nodeAes('aes-128-cbc', key, iv, Buffer.from('data'), true).toString('base64'),
    );
    expect(call("aesX('AES/ECB/PKCS5', true, 'data', false, 'short', null, true)")).toBe(
      nodeAes('aes-128-ecb', key, null, Buffer.from('data'), true).toString('base64'),
    );
  });

  it('aesX returns "" on failure', () => {
    expect(call("aesX('AES/XYZ/PKCS5', true, 'data', false, 'k', null, true)")).toBe('');
    expect(host.log).toHaveBeenCalledWith('error', expect.stringContaining('aesX failed'));
  });
});

describe('pd helpers (Parser.java on cheerio)', () => {
  const HTML = `<html><body>
    <div class="list">
      <ul>
        <li class="item"><a href="/v/1" data-src="/img/1.jpg" title="First">First  item</a><span class="ad">ad</span></li>
        <li class="item"><a href="https://cdn.example.com/v/2" style="background:url('/img/2.jpg')">Second</a></li>
        <li class="item"><a href="magnet:?xt=3">Third</a></li>
      </ul>
    </div>
  </body></html>`;

  let runtime: NodeSpiderRuntime;
  let id: number;

  beforeAll(async () => {
    runtime = new NodeSpiderRuntime();
    id = await runtime.createContext();
    await runtime.evaluate(id, PRELUDE, 'prelude.js', false, 5000);
    await runtime.evaluate(id, PARSER_MODULE, PARSER_FILENAME, true, 5000);
    await runtime.evaluate(
      id,
      'globalThis.P = { pd: (...a) => pd(...a), pdfh: (...a) => pdfh(...a), pdfa: (...a) => pdfa(...a), pdfl: (...a) => pdfl(...a) };',
      'p.js',
      false,
      5000,
    );
  });

  const call = async (method: string, ...args: string[]) => JSON.parse(await runtime.call(id, 'P', method, JSON.stringify([HTML, ...args]), 5000)) as unknown;

  it('pdfh reads text, attributes and the first match by default', async () => {
    expect(await call('pdfh', '.item&&Text')).toBe('First itemad');
    expect(await call('pdfh', '.item:eq(1) a&&Text')).toBe('Second');
    expect(await call('pdfh', '.item:eq(-1)&&Text')).toBe('Third');
    expect(await call('pdfh', 'ul&&li:eq(1)&&Text')).toBe('Second');
    expect(await call('pdfh', '.item a&&title')).toBe('First');
    expect(await call('pdfh', '.missing&&Text')).toBe('');
    expect(await call('pdfh', '.item--.ad&&Text')).toBe('First item');
  });

  it('pd joins url-like attributes with the base url', async () => {
    expect(await call('pd', '.item a&&href', 'https://h.example.com/list/')).toBe('https://h.example.com/v/1');
    expect(await call('pd', '.item a&&data-src', 'https://h.example.com/list/')).toBe('https://h.example.com/img/1.jpg');
    expect(await call('pd', '.item:eq(1) a&&href', 'https://h.example.com/')).toBe('https://cdn.example.com/v/2');
    expect(await call('pd', '.item:eq(1) a&&style', 'https://h.example.com/')).toBe('https://h.example.com/img/2.jpg');
    expect(await call('pd', '.item:eq(2) a&&href', 'https://h.example.com/')).toBe('magnet:?xt=3');
    expect(await call('pd', '.item a&&title||href', 'https://h.example.com/')).toBe('First');
  });

  it('pdfa returns the outer html of every match', async () => {
    const items = (await call('pdfa', '.list&&li')) as string[];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/^<li class="item">/);
    expect(await call('pdfa', '.nothing&&li')).toEqual([]);
  });

  it('pdfl builds "text$url" entries', async () => {
    expect(await call('pdfl', '.list&&li', 'a&&Text', 'a&&href', 'https://h.example.com/')).toEqual([
      'First item$https://h.example.com/v/1',
      'Second$https://cdn.example.com/v/2',
      'Third$magnet:?xt=3',
    ]);
  });

  it('returns null when the selector is invalid', async () => {
    expect(await call('pdfh', 'a[&&Text')).toBeNull();
  });
});

describe('entry and detection', () => {
  it('spiderEntry imports the api as a quoted module name', () => {
    expect(spiderEntry("https://x/a'b.js")).toContain('import * as spider from "https://x/a\'b.js"');
  });

  it('detects helper usage', () => {
    expect(usesCrypto('const k = md5X(a)')).toBe(true);
    expect(usesCrypto('const md5 = 1')).toBe(false);
    expect(usesParser('pdfh(html, "a&&Text")')).toBe(true);
    expect(usesParser('const pdf = 1; pd (x)')).toBe(true);
    expect(usesParser('updfh(x)')).toBe(false);
  });
});
