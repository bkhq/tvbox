import type { JarSpiderNative } from '../../../modules/jarspider';
import { parseSite } from '../../core/config/vodConfig';
import { getProvider, resetProviderRegistry } from '../../core/provider';
import { registerJsSpiderProvider, setSpiderRuntime } from '../../spider';
import { NodeSpiderRuntime } from '../../spider/__testutils__/nodeRuntime';
import { proxyProcess } from '../api/proxy';
import { request, setup, site } from '../__fixtures__/fakes';
import type { LanRequest } from '../types';

/** Echoes which site answered and the params it got. */
const ECHO_SPIDER = `
let name = '';
export default {
    async init(ext) { name = ext; },
    async home() { return { class: [] }; },
    async proxy(params) {
        if (params.empty) return null;
        return [200, 'application/json', JSON.stringify({ name, params })];
    },
};
`;

const jsSite = (key: string) => parseSite({ key, name: key, type: 3, api: `https://s.example.com/${key}.js`, ext: key });
const sites = [jsSite('js1'), jsSite('js2'), site('cms')];

function fakeJar(answer: Awaited<ReturnType<JarSpiderNative['proxy']>> = null) {
  return { proxy: jest.fn(async (_params: string) => answer) } as unknown as JarSpiderNative & { proxy: jest.Mock };
}

beforeEach(() => {
  setSpiderRuntime(new NodeSpiderRuntime());
  registerJsSpiderProvider();
  jest.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) => ({ ok: true, status: 200, url: String(url), text: async () => ECHO_SPIDER }) as Response,
  );
});

afterEach(() => {
  resetProviderRegistry();
  setSpiderRuntime(undefined);
  jest.restoreAllMocks();
});

async function proxy(init: Partial<LanRequest>, jar: JarSpiderNative | null = null) {
  const { server } = await setup({ sites });
  const process = proxyProcess(server.context, jar);
  const req = request('/proxy', init);
  return process.handle(req, { ...req.query, ...req.form });
}

const echo = (res: { body?: string }) => JSON.parse(res.body ?? '') as { name: string; params: Record<string, string> };

describe('/proxy', () => {
  it('is routed by the server without pairing, from remote addresses too', async () => {
    const { server } = await setup({ sites });
    const res = await server.handle(request('/proxy', { query: { siteKey: 'js1', a: '1' } }));
    expect(res.status).toBe(200);
    expect(echo(res).name).toBe('js1');
    expect((await server.handle(request('/proxy'))).body).toBe('Invalid proxy response');
  });

  it('siteKey of a JS spider site goes to that spider with query, form and headers', async () => {
    const res = await proxy({ query: { siteKey: 'js2', url: 'q' }, form: { url: 'f' }, headers: { range: 'bytes=0-' } }, fakeJar());
    expect(res).toMatchObject({ status: 200, headers: { 'Content-Type': 'application/json' }, bodyEncoding: 'utf8' });
    expect(echo(res)).toEqual({ name: 'js2', params: { siteKey: 'js2', url: 'f', range: 'bytes=0-' } });
  });

  it('do=js goes to the most recently used JS spider', async () => {
    const { server } = await setup({ sites });
    await getProvider(jsSite('js1')).home(false);
    const js2 = sites[1]!;
    await getProvider(js2).home(false);
    const res = await proxyProcess(server.context, null).handle(request('/proxy'), { do: 'js', x: '1' });
    expect(echo(res)).toEqual({ name: 'js2', params: { do: 'js', x: '1' } });
  });

  it('do=js without a recent spider, or a null spider answer, is an invalid response', async () => {
    expect(await proxy({ query: { do: 'js' } })).toMatchObject({ status: 500, body: 'Invalid proxy response' });
    expect(await proxy({ query: { siteKey: 'js1', empty: '1' } })).toMatchObject({ status: 500, body: 'Invalid proxy response' });
  });

  it('other requests (JAR siteKey, no siteKey) go to JarSpider.proxy', async () => {
    const jar = fakeJar({ status: 206, mime: 'video/mp2t', headers: { 'Accept-Ranges': 'bytes' }, body: 'AAEC' });
    const res = await proxy({ query: { siteKey: 'cms', do: 'ali' }, headers: { 'user-agent': 'ua' } }, jar);
    expect(res).toEqual({
      status: 206,
      headers: { 'Content-Type': 'video/mp2t', 'Accept-Ranges': 'bytes' },
      body: 'AAEC',
      bodyEncoding: 'base64',
    });
    expect(JSON.parse(jar.proxy.mock.calls[0]?.[0] as string)).toEqual({ siteKey: 'cms', do: 'ali', 'user-agent': 'ua' });
    await proxy({ query: { url: 'x' } }, jar);
    expect(JSON.parse(jar.proxy.mock.calls[1]?.[0] as string)).toEqual({ url: 'x' });
  });

  it('answers 500 when nothing handles the request', async () => {
    expect(await proxy({ query: { url: 'x' } }, fakeJar(null))).toMatchObject({ status: 500, body: 'Invalid proxy response' });
    expect(await proxy({ query: { url: 'x' } }, null)).toMatchObject({ status: 500, body: 'Invalid proxy response' });
  });
});
