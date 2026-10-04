import { bodyJson, fakePlayer, fakeServerLink, setup } from '../__fixtures__/fakes';
import type { LanSources } from '../ports';

function fakeSources(extra: Partial<LanSources> = {}): LanSources {
  return {
    lives: () => [{ key: 'L1', name: 'L1' }],
    currentLive: () => 'L1',
    setLive: (name) => name === 'L1',
    parses: () => [{ key: 'P1', name: 'P1' }],
    currentParse: () => 'P1',
    setParse: (name) => name === 'P1',
    ...extra,
  };
}

describe('/api/state', () => {
  it('returns the full shape with ports, configs, devices and enroll', async () => {
    const { player } = fakePlayer({ position: -5, playing: false });
    const env = { version: '1.2.3', address: () => 'http://192.168.1.2:9978' };
    const sources = fakeSources({ cacheSize: async () => '12 MB' });
    const { call, pairing, vod, live, settings, server } = await setup({
      ports: { player, env, sources },
      serverLink: fakeServerLink(true, { state: 'LINKED', code: 'WXYZ-2345' }),
    });
    const device = await pairing.pair(pairing.getCode(), 'Phone', 'UA', '1.1.1.1');
    await vod.add({ url: 'https://vod.example/a.json', name: 'A' });
    await vod.setActive('https://vod.example/a.json');
    await live.add({ url: 'https://live.example/l.m3u' });
    await settings.set('homeSiteKey', 'b');
    server.context.settingsProvider = () => [{ group: 'general', items: [] }];

    const state = bodyJson(await call('/api/state', {}, { headers: { 'x-token': 'tok' } }));
    expect(state).toEqual({
      version: '1.2.3',
      address: 'http://192.168.1.2:9978',
      token: 'tok',
      devices: [{ token: device?.token, name: 'Phone', agent: 'UA', ip: '1.1.1.1', time: 1_000_000, last: 1_000_000 }],
      vod: { current: 'https://vod.example/a.json', items: [{ url: 'https://vod.example/a.json', name: 'A', time: 1_000_000 }] },
      live: { current: '', items: [{ url: 'https://live.example/l.m3u', name: '', time: 1_000_000 }] },
      wall: { current: '', items: [] },
      settings: [{ group: 'general', items: [] }],
      sources: {
        sites: [
          { key: 'a', name: 'Site a' },
          { key: 'b', name: 'Site b' },
        ],
        site: 'b',
        lives: [{ key: 'L1', name: 'L1' }],
        live: 'L1',
        parses: [{ key: 'P1', name: 'P1' }],
        parse: 'P1',
      },
      cache: '12 MB',
      enroll: { available: true, state: 'linked', code: 'WXYZ-2345' },
      player: { active: true, playing: false, title: 'Movie', position: 0, duration: 60_000, speed: 1 },
    });
  });

  it('falls back when ports, config and server link are missing', async () => {
    const { call, setSnapshot } = await setup();
    setSnapshot({ status: 'empty' });
    const state = bodyJson(await call('/api/state'));
    expect(state).toMatchObject({
      version: '',
      address: '',
      token: '',
      devices: [],
      vod: { current: '', items: [] },
      settings: expect.arrayContaining([expect.objectContaining({ key: 'general' })]),
      sources: { sites: [], site: '', lives: [], live: '', parses: [], parse: '' },
      cache: '0 B',
      enroll: { available: false, state: 'off', code: '' },
      player: { active: false },
    });
  });

  it('uses the config home site when no home key is set', async () => {
    const { call } = await setup();
    expect((bodyJson(await call('/api/state')).sources as { site: string }).site).toBe('a');
  });

  it('only=player returns the player alone', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    expect(bodyJson(await call('/api/state', { only: 'player' }))).toEqual({
      player: { active: true, playing: true, title: 'Movie', position: 10_000, duration: 60_000, speed: 1 },
    });
  });

  it('reports an inactive player as {active:false}', async () => {
    const { player } = fakePlayer({ active: false });
    const { call } = await setup({ ports: { player } });
    expect(bodyJson(await call('/api/state', { only: 'player' }))).toEqual({ player: { active: false } });
  });
});

describe('/api/source', () => {
  it('sets the home site among supported sites', async () => {
    const { call, settings } = await setup();
    expect(await call('/api/source', { do: 'site', value: 'b' })).toMatchObject({ status: 200, body: 'OK' });
    expect(settings.get('homeSiteKey')).toBe('b');
    expect(await call('/api/source', { do: 'site', value: 'jar' })).toMatchObject({ status: 404, body: 'site not found' });
    expect(await call('/api/source', { do: 'site', value: 'zzz' })).toMatchObject({ status: 404, body: 'site not found' });
  });

  it('selects live and parse through the sources port', async () => {
    const { call, ports } = await setup();
    expect(await call('/api/source', { do: 'live', value: 'L1' })).toMatchObject({ status: 404, body: 'live not found' });
    expect(await call('/api/source', { do: 'parse', value: 'P1' })).toMatchObject({ status: 404, body: 'parse not found' });
    ports.sources = fakeSources();
    expect((await call('/api/source', { do: 'live', value: 'L1' })).status).toBe(200);
    expect((await call('/api/source', { do: 'live', value: 'L2' })).status).toBe(404);
    expect((await call('/api/source', { do: 'parse', value: 'P1' })).status).toBe(200);
    expect((await call('/api/source', { do: 'parse', value: 'P2' })).status).toBe(404);
  });

  it('clears the cache and backs up when supported', async () => {
    const { call, ports } = await setup();
    ports.sources = fakeSources();
    expect(await call('/api/source', { do: 'cache' })).toMatchObject({ status: 400, body: '不支持' });
    expect(await call('/api/source', { do: 'backup' })).toMatchObject({ status: 400, body: '不支持' });
    const clearCache = jest.fn(async () => undefined);
    const backup = jest.fn(async () => true);
    ports.sources = fakeSources({ clearCache, backup });
    expect((await call('/api/source', { do: 'cache' })).status).toBe(200);
    expect((await call('/api/source', { do: 'backup' })).status).toBe(200);
    expect(clearCache).toHaveBeenCalled();
    expect(backup).toHaveBeenCalled();
    expect(await call('/api/source', { do: 'x' })).toMatchObject({ status: 400, body: 'Unknown do' });
  });
});

describe('/api/config', () => {
  it('validates type, url and do', async () => {
    const { call } = await setup();
    expect(await call('/api/config', { do: 'use', type: '2', url: 'u' })).toMatchObject({ status: 400, body: 'wallpaper not supported' });
    expect(await call('/api/config', { do: 'use', type: 'x', url: 'u' })).toMatchObject({ status: 400, body: 'Invalid type' });
    expect(await call('/api/config', { do: 'use', type: '0', url: ' ' })).toMatchObject({ status: 400, body: 'url required' });
    expect(await call('/api/config', { do: 'x', type: '0', url: 'u' })).toMatchObject({ status: 400, body: 'Unknown do' });
  });

  it('uses a VOD config through the bootstrap, keeping the given name', async () => {
    const { call, bootstrap, vod } = await setup();
    expect((await call('/api/config', { do: 'use', type: '0', url: ' https://v/1 ', name: 'One' })).status).toBe(200);
    expect(bootstrap.addConfig).toHaveBeenCalledWith('https://v/1');
    expect(await vod.getActive()).toMatchObject({ url: 'https://v/1', name: 'One' });
  });

  it('uses a live config by saving and activating it', async () => {
    const { call, live } = await setup();
    expect((await call('/api/config', { do: 'use', type: '1', url: 'https://l/1' })).status).toBe(200);
    expect((await live.getActive())?.url).toBe('https://l/1');
  });

  it('deletes saved configs but not the active one', async () => {
    const { call, vod } = await setup();
    await vod.add({ url: 'https://v/1' });
    await vod.add({ url: 'https://v/2' });
    await vod.setActive('https://v/1');
    expect(await call('/api/config', { do: 'delete', type: '0', url: 'https://v/1' })).toMatchObject({ status: 400, body: 'config in use' });
    expect((await call('/api/config', { do: 'delete', type: '0', url: 'https://v/2' })).status).toBe(200);
    expect((await vod.list()).map((item) => item.url)).toEqual(['https://v/1']);
  });
});

describe('/api/enroll', () => {
  it('is unavailable without a server link', async () => {
    const { call } = await setup({ serverLink: fakeServerLink(false) });
    expect(await call('/api/enroll', { do: 'request' })).toMatchObject({ status: 400, body: 'server link not available in this build' });
    const { call: call2 } = await setup();
    expect((await call2('/api/enroll', { do: 'request' })).status).toBe(400);
  });

  it('dispatches request, refresh and unlink', async () => {
    const link = fakeServerLink(true);
    const { call } = await setup({ serverLink: link });
    for (const action of ['request', 'refresh', 'unlink'] as const) {
      expect((await call('/api/enroll', { do: action })).status).toBe(200);
      expect(link[action]).toHaveBeenCalledTimes(1);
    }
    expect(await call('/api/enroll', { do: 'x' })).toMatchObject({ status: 400, body: 'Unknown do' });
  });
});
