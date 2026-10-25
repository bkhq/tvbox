import { MemoryStore } from '../../core/storage/keyValueStore';
import { counterBytes, request } from '../__fixtures__/fakes';
import { createPairing, isProtectedPath, LAN_DEVICE_ID_KEY, PAIRED_DEVICES_KEY } from '../pairing';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function make(store = new MemoryStore(), now = () => 1000) {
  return createPairing({ store, randomBytes: counterBytes(), now });
}

describe('pairing', () => {
  it('generates a 6-digit code and rotates it on refresh', () => {
    const pairing = make();
    const first = pairing.getCode();
    expect(first).toMatch(/^\d{6}$/);
    pairing.refreshCode();
    expect(pairing.getCode()).toMatch(/^\d{6}$/);
    expect(pairing.getCode()).not.toBe(first);
  });

  it('rejects rejection-sampled values outside the uniform range', () => {
    // 0xffffffff is above the largest multiple of 1e6; the next draw (0x00000001) is used.
    const draws = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1];
    const pairing = createPairing({ store: new MemoryStore(), randomBytes: (n) => Uint8Array.from(draws.splice(0, n)) });
    expect(pairing.getCode()).toBe('000001');
  });

  it('keeps one device id per TV across restarts', async () => {
    const store = new MemoryStore();
    const first = make(store);
    await first.ready;
    expect(first.getDeviceId()).toMatch(/^[0-9a-f]{16}$/);
    expect(store.data.get(LAN_DEVICE_ID_KEY)).toBe(JSON.stringify(first.getDeviceId()));
    const restarted = createPairing({ store, randomBytes: () => new Uint8Array(24).fill(7) });
    await restarted.ready;
    expect(restarted.getDeviceId()).toBe(first.getDeviceId());
  });

  it('turns the QR key into the token of the first phone that uses it, then rotates the key', async () => {
    const store = new MemoryStore();
    const pairing = make(store);
    await pairing.ready;
    const listener = jest.fn();
    pairing.subscribe(listener);
    const key = pairing.getKey();
    expect(key).toMatch(/^[0-9a-f]{48}$/);

    const use = (token: string, remoteAddress = '192.168.1.30') =>
      pairing.allow(request('/api/state', { remoteAddress, query: { token }, headers: { 'user-agent': 'Safari' } }));
    expect(use('f'.repeat(48))).toBe(false);
    expect(use(key)).toBe(true);
    expect(pairing.find(key)).toMatchObject({ token: key, agent: 'Safari', ip: '192.168.1.30' });
    expect(pairing.getKey()).not.toBe(key);
    expect(listener).toHaveBeenCalled();
    // The claimed key is now that phone's token; the device list does not grow on reuse.
    expect(use(key, '192.168.1.31')).toBe(true);
    expect(pairing.devices()).toHaveLength(1);
    await flush();
    expect(JSON.parse(store.data.get(PAIRED_DEVICES_KEY) ?? '[]')[0].token).toBe(key);
  });

  it('pairs with the right code, rotates it and issues a 48-char hex token', async () => {
    const pairing = make();
    expect(await pairing.pair('000000', 'x', 'ua', '1.2.3.4')).toBeNull();
    expect(await pairing.pair(undefined, 'x', 'ua', '1.2.3.4')).toBeNull();
    const code = pairing.getCode();
    const device = await pairing.pair(code, '', 'agent', '1.2.3.4');
    expect(device).toMatchObject({ name: '1.2.3.4', agent: 'agent', ip: '1.2.3.4', time: 1000, last: 1000 });
    expect(device?.token).toMatch(/^[0-9a-f]{48}$/);
    expect(pairing.getCode()).not.toBe(code);
    expect(await pairing.pair(code, 'again', '', '1.2.3.4')).toBeNull();
    expect(pairing.find(device?.token)).toEqual(device);
  });

  it('persists devices and unpairs', async () => {
    const store = new MemoryStore();
    const pairing = make(store);
    const device = await pairing.pair(pairing.getCode(), 'Phone', undefined, '1.2.3.4');
    expect(JSON.parse(store.data.get(PAIRED_DEVICES_KEY) ?? '[]')).toHaveLength(1);

    const reloaded = make(store);
    await reloaded.ready;
    expect(reloaded.devices()).toEqual([device]);
    expect(await reloaded.unpair('nope')).toBe(false);
    expect(await reloaded.unpair(device?.token ?? '')).toBe(true);
    expect(reloaded.devices()).toEqual([]);

    const again = make(store);
    await again.ready;
    expect(again.devices()).toEqual([]);
  });

  it('notifies subscribers on code and device changes', async () => {
    const pairing = make();
    await pairing.ready;
    const listener = jest.fn();
    const off = pairing.subscribe(listener);
    pairing.refreshCode();
    expect(listener).toHaveBeenCalledTimes(1);
    await pairing.pair(pairing.getCode(), 'p', '', '1.1.1.1');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    pairing.refreshCode();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  describe('allow', () => {
    it('lets local addresses and unprotected paths through', () => {
      const pairing = make();
      for (const ip of ['127.0.0.1', '::1', '0:0:0:0:0:0:0:1']) expect(pairing.allow(request('/api/state', { remoteAddress: ip }))).toBe(true);
      expect(pairing.allow(request('/'))).toBe(true);
      expect(pairing.allow(request('/css/ui.css'))).toBe(true);
      expect(pairing.allow(request('/api/pair'))).toBe(true);
      expect(pairing.allow(request('/api/state'))).toBe(false);
    });

    it('classifies protected paths', () => {
      for (const path of ['/api/state', '/api/unpair', '/action', '/file/x', '/upload', '/newFolder', '/delFolder', '/delFile']) {
        expect(isProtectedPath(path)).toBe(true);
      }
      for (const path of ['/api/pair', '/api/link', '/', '/index.html', '/proxy', '/api']) expect(isProtectedPath(path)).toBe(false);
    });

    it('accepts the token from the header or a parameter and touches the device', async () => {
      const store = new MemoryStore();
      let now = 1000;
      const pairing = createPairing({ store, randomBytes: counterBytes(), now: () => now });
      const device = await pairing.pair(pairing.getCode(), 'p', '', '1.1.1.1');
      const token = device?.token ?? '';
      const saved = () => JSON.parse(store.data.get(PAIRED_DEVICES_KEY) ?? '[]')[0];

      expect(pairing.allow(request('/api/state', { headers: { 'x-token': 'bad' } }))).toBe(false);
      expect(pairing.allow(request('/api/state', { remoteAddress: '1.1.1.1', headers: { 'x-token': token } }))).toBe(true);
      expect(pairing.allow(request('/api/state', { remoteAddress: '1.1.1.1', query: { token } }))).toBe(true);
      expect(pairing.allow(request('/upload', { remoteAddress: '1.1.1.1', form: { token } }))).toBe(true);

      now += 5000;
      expect(pairing.allow(request('/api/state', { remoteAddress: '1.1.1.1', query: { token } }))).toBe(true);
      expect(pairing.find(token)?.last).toBe(6000);
      await flush();
      expect(saved().last).toBe(1000); // fresh and same ip: not persisted

      expect(pairing.allow(request('/api/state', { remoteAddress: '2.2.2.2', query: { token } }))).toBe(true);
      await flush();
      expect(saved()).toMatchObject({ ip: '2.2.2.2', last: 6000 });

      now += 61_000;
      expect(pairing.allow(request('/api/state', { remoteAddress: '2.2.2.2', query: { token } }))).toBe(true);
      await flush();
      expect(saved().last).toBe(67_000);
    });
  });
});
