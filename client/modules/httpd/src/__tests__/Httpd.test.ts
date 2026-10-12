import {
  addRequestListener,
  adjustVolume,
  getLocalIpAddress,
  isAvailable,
  respond,
  sendKey,
  sendText,
  startServer,
  stopServer,
} from '../..';
import type { HttpdKey, HttpdVolumeDirection } from '../..';

describe('httpd without the native module', () => {
  it('reports unavailable', () => {
    expect(isAvailable()).toBe(false);
  });

  it('rejects startServer', async () => {
    await expect(startServer({ portFrom: 9978, portTo: 9998 })).rejects.toThrow('not available');
  });

  it('degrades the other calls to no-ops', async () => {
    await expect(stopServer()).resolves.toBeUndefined();
    expect(() => respond('1', { status: 200, body: 'OK' })).not.toThrow();
    const subscription = addRequestListener(() => {});
    expect(() => subscription.remove()).not.toThrow();
    expect(getLocalIpAddress()).toBeNull();
    await expect(sendKey('ok')).resolves.toBe(false);
    await expect(sendText('hello')).resolves.toBe(false);
    await expect(adjustVolume('mute')).resolves.toBe(false);
  });
});

describe('httpd argument validation', () => {
  it.each([
    [0, 10],
    [9978.5, 9998],
    [9998, 9978],
    [9978, 65536],
    [Number.NaN, 9998],
  ])('rejects port range %p..%p', async (portFrom, portTo) => {
    await expect(startServer({ portFrom, portTo })).rejects.toThrow(RangeError);
  });

  it.each(['', '-tvbox', 'tv box', 'tvbox.local', 'a'.repeat(64)])('rejects mDNS name %p', async (mdnsName) => {
    await expect(startServer({ portFrom: 9978, portTo: 9998, mdnsName })).rejects.toThrow(RangeError);
  });

  it('accepts a valid mDNS name up to the native check', async () => {
    await expect(startServer({ portFrom: 9978, portTo: 9978, mdnsName: 'tvbox-2' })).rejects.toThrow('not available');
  });

  it.each([99, 100, 600, 200.5, Number.NaN])('rejects response status %p', (status) => {
    expect(() => respond('1', { status })).toThrow(RangeError);
  });

  it('rejects unknown keys and volume directions', async () => {
    await expect(sendKey('home' as HttpdKey)).rejects.toThrow(RangeError);
    await expect(adjustVolume('loud' as HttpdVolumeDirection)).rejects.toThrow(RangeError);
  });
});
