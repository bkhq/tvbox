import { bodyJson, fakePlayer, setup } from '../__fixtures__/fakes';

describe('/api/push', () => {
  it('plays the url', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    expect(await call('/api/push', { url: 'https://v.example/a.m3u8' })).toMatchObject({ status: 200, body: 'OK' });
    expect(player.playUrl).toHaveBeenCalledWith('https://v.example/a.m3u8');
  });

  it('requires a url and a player', async () => {
    const { player } = fakePlayer();
    expect(await (await setup({ ports: { player } })).call('/api/push')).toMatchObject({ status: 400, body: 'url required' });
    expect(await (await setup()).call('/api/push', { url: 'x' })).toMatchObject({ status: 400, body: 'player not available' });
  });
});

describe('/media', () => {
  it('answers {} without a player, even for unpaired clients', async () => {
    const { call } = await setup();
    const res = await call('/media', {}, { remoteAddress: '192.168.1.20' });
    expect(res.status).toBe(200);
    expect(bodyJson(res)).toEqual({});
  });

  it('describes the player state', async () => {
    const { player, state } = fakePlayer({ url: 'https://v.example/a.mp4', artwork: 'https://img.example/a.jpg', speed: 1.5 });
    const { call } = await setup({ ports: { player } });
    expect(bodyJson(await call('/media'))).toEqual({
      state: 3,
      speed: 1.5,
      duration: 60_000,
      position: 10_000,
      url: 'https://v.example/a.mp4',
      title: 'Movie',
      artist: '',
      artwork: 'https://img.example/a.jpg',
    });
    state.playing = false;
    expect(bodyJson(await call('/media')).state).toBe(2);
    state.active = false;
    expect(bodyJson(await call('/media/info')).state).toBe(1);
  });
});
