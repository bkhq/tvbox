import { setup } from '../__fixtures__/fakes';
import type { LanRemote } from '../ports';

function fakeRemote(result = true) {
  return {
    sendKey: jest.fn(async () => result),
    sendText: jest.fn(async () => result),
    adjustVolume: jest.fn(async () => result),
  } satisfies LanRemote;
}

describe('/api/remote', () => {
  it.each(['up', 'down', 'left', 'right', 'ok', 'back', 'menu'])('sends key %s', async (value) => {
    const remote = fakeRemote();
    const { call } = await setup({ ports: { remote } });
    expect(await call('/api/remote', { do: 'key', value })).toMatchObject({ status: 200, body: 'OK' });
    expect(remote.sendKey).toHaveBeenCalledWith(value);
  });

  it('sends text', async () => {
    const remote = fakeRemote();
    const { call } = await setup({ ports: { remote } });
    expect((await call('/api/remote', { do: 'text', value: '你好' })).status).toBe(200);
    expect(remote.sendText).toHaveBeenCalledWith('你好');
  });

  it.each(['up', 'down', 'mute'])('adjusts volume %s', async (value) => {
    const remote = fakeRemote();
    const { call } = await setup({ ports: { remote } });
    expect((await call('/api/remote', { do: 'volume', value })).status).toBe(200);
    expect(remote.adjustVolume).toHaveBeenCalledWith(value);
  });

  it('rejects unknown do, key and volume', async () => {
    const remote = fakeRemote();
    const { call } = await setup({ ports: { remote } });
    expect(await call('/api/remote', { do: 'tap' })).toMatchObject({ status: 400, body: 'Unknown do' });
    expect(await call('/api/remote', { do: 'key', value: 'home' })).toMatchObject({ status: 400, body: 'Unknown key' });
    expect(await call('/api/remote', { do: 'volume', value: 'max' })).toMatchObject({ status: 400, body: 'Unknown volume' });
    expect(remote.sendKey).not.toHaveBeenCalled();
    expect(remote.adjustVolume).not.toHaveBeenCalled();
  });

  it('reports failures from the port', async () => {
    const { call } = await setup({ ports: { remote: fakeRemote(false) } });
    expect(await call('/api/remote', { do: 'key', value: 'ok' })).toMatchObject({
      status: 400,
      body: 'the app is not in the foreground on the TV',
    });
    expect(await call('/api/remote', { do: 'text', value: 'a' })).toMatchObject({
      status: 400,
      body: 'no text field is focused on the TV',
    });
    expect(await call('/api/remote', { do: 'volume', value: 'up' })).toMatchObject({ status: 400, body: 'volume not supported' });
  });

  it('reports a missing port', async () => {
    const { call } = await setup();
    const foreground = { status: 400, body: 'the app is not in the foreground on the TV' };
    expect(await call('/api/remote', { do: 'key', value: 'ok' })).toMatchObject(foreground);
    expect(await call('/api/remote', { do: 'text', value: 'a' })).toMatchObject(foreground);
    expect(await call('/api/remote', { do: 'volume', value: 'up' })).toMatchObject({ status: 400, body: 'volume not supported' });
  });
});
