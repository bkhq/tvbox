import { Platform } from 'react-native';

import * as httpd from '../../../modules/httpd';
import { startAirPlay } from '../cast/airplay';
import { JarSpider } from '../../../modules/jarspider';
import { spiderProxyScript } from '../../spider/prelude';
import { startDlna } from '../cast/dlna';
import { request } from '../__fixtures__/fakes';
import { getLanPorts } from '../ports';
import { getLanPairing, getLanStatus, refreshLanAddress, startLanServices, stopLanServices, subscribeLanStatus } from '../runtime';
import { createLanServer } from '../server';
import type { LanRequest } from '../types';

let mockListener: ((req: LanRequest) => void) | undefined;

jest.mock('../../../modules/httpd', () => ({
  isAvailable: jest.fn(() => true),
  startServer: jest.fn(async () => 9978),
  stopServer: jest.fn(async () => undefined),
  respond: jest.fn(),
  addRequestListener: jest.fn((listener: (req: LanRequest) => void) => {
    mockListener = listener;
    return { remove: () => (mockListener = undefined) };
  }),
  getLocalIpAddress: jest.fn(() => '192.168.1.5'),
  sendKey: jest.fn(async () => true),
  sendText: jest.fn(async () => true),
  adjustVolume: jest.fn(async () => true),
}));
jest.mock('../../../modules/jarspider', () => ({ JarSpider: { setProxyPort: jest.fn() } }));
jest.mock('../cast/airplay', () => ({ startAirPlay: jest.fn(() => jest.fn()) }));
jest.mock('../cast/dlna', () => ({ startDlna: jest.fn(() => jest.fn()) }));
jest.mock('../files', () => ({ createExpoFileSystem: jest.fn(async () => undefined) }));
jest.mock('../server', () => {
  const actual = jest.requireActual('../server');
  return { ...actual, createLanServer: jest.fn(actual.createLanServer) };
});

const mocked = jest.mocked(httpd);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Sends a request through the transport listener and returns what was answered. */
async function send(req: LanRequest) {
  mockListener?.(req);
  for (let i = 0; i < 5 && mocked.respond.mock.calls.length === 0; i++) await flush();
  return mocked.respond.mock.calls.at(-1);
}

afterEach(async () => {
  await stopLanServices();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('startLanServices', () => {
  it('starts httpd on 9978..9998 as tvbox and publishes the addresses', async () => {
    const seen: string[] = [];
    const off = subscribeLanStatus(() => seen.push(getLanStatus().state));
    await startLanServices();
    off();
    expect(mocked.startServer).toHaveBeenCalledWith({ portFrom: 9978, portTo: 9998, mdnsName: 'tvbox' });
    expect(getLanStatus()).toEqual({
      state: 'running',
      port: 9978,
      address: 'http://192.168.1.5:9978',
      localName: 'http://tvbox.local:9978',
      error: null,
    });
    expect(seen).toEqual(['starting', 'running']);
    expect(getLanPairing()?.getCode()).toMatch(/^\d{6}$/);
  });

  it('hands the bound port to JAR and JS spiders, and resets the JS side on stop', async () => {
    await startLanServices();
    expect(JarSpider?.setProxyPort).toHaveBeenCalledWith(9978);
    expect(spiderProxyScript()).toBe('globalThis.__spider_proxy = {"port":9978,"host":"192.168.1.5"};');
    await stopLanServices();
    expect(spiderProxyScript()).toContain('"port":-1');
  });

  it('registers the ports', async () => {
    await startLanServices();
    const ports = getLanPorts();
    expect(ports.player?.getState().active).toBe(false);
    expect(ports.sources?.lives()).toEqual([]);
    expect(ports.navigator).not.toBeNull();
    expect(ports.env?.address()).toBe('http://192.168.1.5:9978');
    await ports.remote?.sendKey('ok');
    expect(mocked.sendKey).toHaveBeenCalledWith('ok');
  });

  it('is idempotent', async () => {
    const first = startLanServices();
    expect(startLanServices()).toBe(first);
    await first;
    await startLanServices();
    expect(mocked.startServer).toHaveBeenCalledTimes(1);
    expect(mocked.addRequestListener).toHaveBeenCalledTimes(1);
  });

  it('forwards requests to the server and responds', async () => {
    await startLanServices();
    const call = await send(request('/api/state', { id: 'r1', remoteAddress: '127.0.0.1', query: { only: 'player' } }));
    expect(call?.[0]).toBe('r1');
    expect(call?.[1]).toMatchObject({ status: 200 });
    expect(JSON.parse(String(call?.[1].body))).toMatchObject({ player: { active: false } });
  });

  it('answers 401 to unpaired phones on protected paths', async () => {
    await startLanServices();
    expect((await send(request('/api/state', { id: 'r2' })))?.[1]).toMatchObject({ status: 401 });
  });

  it('answers 500 with the message when the server throws', async () => {
    jest.mocked(createLanServer).mockImplementationOnce((...args) => ({
      ...jest.requireActual('../server').createLanServer(...args),
      handle: async () => {
        throw new Error('boom');
      },
    }));
    await startLanServices();
    expect(await send(request('/x', { id: 'r3' }))).toEqual(['r3', expect.objectContaining({ status: 500, body: 'boom' })]);
  });

  it('answers 500 when the response is rejected by the transport', async () => {
    mocked.respond.mockImplementationOnce(() => {
      throw new RangeError('Invalid HTTP status 0');
    });
    await startLanServices();
    mockListener?.(request('/api/state', { id: 'r4', remoteAddress: '127.0.0.1' }));
    for (let i = 0; i < 5 && mocked.respond.mock.calls.length < 2; i++) await flush();
    expect(mocked.respond.mock.calls[1]).toEqual(['r4', expect.objectContaining({ status: 500, body: 'Invalid HTTP status 0' })]);
  });

  it('records the error when httpd is unavailable', async () => {
    mocked.isAvailable.mockReturnValueOnce(false);
    await expect(startLanServices()).resolves.toBeUndefined();
    expect(getLanStatus()).toMatchObject({ state: 'error', port: null, error: 'Httpd native module is not available' });
    expect(mocked.startServer).not.toHaveBeenCalled();
  });

  it('records the error when no port is free', async () => {
    mocked.startServer.mockRejectedValueOnce(new Error('No free port'));
    await startLanServices();
    expect(getLanStatus()).toMatchObject({ state: 'error', error: 'No free port' });
  });

  it('follows the LAN IP', async () => {
    await startLanServices();
    mocked.getLocalIpAddress.mockReturnValue('10.0.0.9');
    refreshLanAddress();
    expect(getLanStatus().address).toBe('http://10.0.0.9:9978');
    mocked.getLocalIpAddress.mockReturnValue('192.168.1.5');
  });

  it('does not start AirPlay or DLNA off Android TV', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await startLanServices();
    expect(startAirPlay).not.toHaveBeenCalled();
    expect(startDlna).not.toHaveBeenCalled();
  });

  it('starts AirPlay and DLNA on Android TV with the LAN player', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(true);
    await startLanServices();
    expect(startAirPlay).toHaveBeenCalledTimes(1);
    expect(startDlna).toHaveBeenCalledTimes(1);
    const airplay = jest.mocked(startAirPlay).mock.calls[0]![0];
    const dlna = jest.mocked(startDlna).mock.calls[0]![0];
    expect(airplay.getPlayer()).toBe(getLanPorts().player);
    expect(dlna.getPlayer()).toBe(getLanPorts().player);
    expect(dlna.name()).toBe('');
    await stopLanServices();
    expect(jest.mocked(startAirPlay).mock.results[0]!.value).toHaveBeenCalled();
    expect(jest.mocked(startDlna).mock.results[0]!.value).toHaveBeenCalled();
  });
});
