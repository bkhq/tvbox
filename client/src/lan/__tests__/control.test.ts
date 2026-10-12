import { fakePlayer, setup } from '../__fixtures__/fakes';

describe('/api/control', () => {
  it.each(['play', 'pause', 'stop', 'prev', 'next', 'repeat', 'replay'] as const)('dispatches %s', async (action) => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    expect(await call('/api/control', { do: action })).toMatchObject({ status: 200, body: 'OK' });
    expect(player[action]).toHaveBeenCalledTimes(1);
  });

  it('toggles between play and pause', async () => {
    const { player, state } = fakePlayer({ playing: true });
    const { call } = await setup({ ports: { player } });
    await call('/api/control', { do: 'toggle' });
    expect(player.pause).toHaveBeenCalledTimes(1);
    state.playing = false;
    await call('/api/control', { do: 'toggle' });
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('seeks relative to the current position, clamped at 0', async () => {
    const { player } = fakePlayer({ position: 10_000 });
    const { call } = await setup({ ports: { player } });
    await call('/api/control', { do: 'seek', value: '15000' });
    await call('/api/control', { do: 'seek', value: '-60000' });
    expect(player.seekTo.mock.calls).toEqual([[25_000], [0]]);
  });

  it('seeks to an absolute position, clamped at 0', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    await call('/api/control', { do: 'seekto', value: '42000' });
    await call('/api/control', { do: 'seekto', value: '-1' });
    expect(player.seekTo.mock.calls).toEqual([[42_000], [0]]);
  });

  it('sets the speed within [0.1, 5]', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    for (const value of ['0.1', '1.5', '5']) expect((await call('/api/control', { do: 'speed', value })).status).toBe(200);
    expect(player.setSpeed.mock.calls).toEqual([[0.1], [1.5], [5]]);
    for (const value of ['0.05', '5.1', 'fast', '', 'NaN']) {
      expect(await call('/api/control', { do: 'speed', value })).toMatchObject({ status: 400, body: 'Invalid value' });
    }
  });

  it('rejects bad seek values before touching the player', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    for (const value of ['abc', '1.5', '']) {
      expect(await call('/api/control', { do: 'seek', value })).toMatchObject({ status: 400, body: 'Invalid value' });
      expect(await call('/api/control', { do: 'seekto', value })).toMatchObject({ status: 400, body: 'Invalid value' });
    }
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it('defaults a missing value to 0', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    expect((await call('/api/control', { do: 'seekto' })).status).toBe(200);
    expect(player.seekTo).toHaveBeenCalledWith(0);
  });

  it('rejects unknown commands', async () => {
    const { player } = fakePlayer();
    const { call } = await setup({ ports: { player } });
    expect(await call('/api/control', { do: 'jump' })).toMatchObject({ status: 400, body: 'Unknown do' });
  });

  it('needs an active player', async () => {
    const { call } = await setup();
    expect(await call('/api/control', { do: 'play' })).toMatchObject({ status: 400, body: 'player not running' });
    const { player } = fakePlayer({ active: false });
    const { call: call2 } = await setup({ ports: { player } });
    expect(await call2('/api/control', { do: 'play' })).toMatchObject({ status: 400, body: 'player not running' });
    expect(player.play).not.toHaveBeenCalled();
  });
});
