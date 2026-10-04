import { Platform } from 'react-native';

import * as httpd from '../../modules/httpd';
import { getAppConfig } from '../core/appConfig';
import { getBootstrap } from '../core/bootstrap';
import { getServerLink, isServerLinkEnabled } from '../core/serverLink';
import { appSettings } from '../core/settings';
import { asyncStorageStore, createConfigRepository } from '../core/storage';
import { startAirPlay } from './cast/airplay';
import { startDlna } from './cast/dlna';
import { createExpoFileSystem } from './files';
import { createLanNavigator } from './navigation';
import { createPairing, type Pairing } from './pairing';
import { createLanPlayer, createLanSources } from './playerAdapter';
import { getLanPorts, setLanPorts } from './ports';
import { serverError } from './reply';
import { createLanServer, type LanServer } from './server';
import type { LanRequest, LanResponse } from './types';

/** Server.java: first free port from 9978, announced as tvbox.local. */
export const LAN_PORT_FROM = 9978;
export const LAN_PORT_TO = 9998;
export const LAN_MDNS_NAME = 'tvbox';

export interface LanStatus {
  state: 'idle' | 'starting' | 'running' | 'error';
  port: number | null;
  /** http://<lan ip>:<port>; '' until running. */
  address: string;
  /** http://tvbox.local:<port>; '' until running. */
  localName: string;
  error: string | null;
}

const IDLE: LanStatus = { state: 'idle', port: null, address: '', localName: '', error: null };

let status: LanStatus = IDLE;
let pairing: Pairing | null = null;
let started: Promise<void> | null = null;
let cleanups: (() => void)[] = [];
const listeners = new Set<() => void>();

const messageOf = (error: unknown) => (error instanceof Error ? error.message || error.name : String(error));

function setStatus(next: Partial<LanStatus>): void {
  status = { ...status, ...next };
  for (const listener of [...listeners]) listener();
}

const addressOf = (port: number) => `http://${httpd.getLocalIpAddress() ?? '127.0.0.1'}:${port}`;

export function getLanStatus(): LanStatus {
  return status;
}

export function subscribeLanStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pairing of the running services; null before startLanServices. */
export function getLanPairing(): Pairing | null {
  return pairing;
}

/** Re-reads the LAN IP (it changes with the network); call when showing the address. */
export function refreshLanAddress(): void {
  if (status.port === null) return;
  const address = addressOf(status.port);
  if (address !== status.address) setStatus({ address });
}

/** Answers one transport request; never throws. */
async function forward(server: LanServer, req: LanRequest): Promise<void> {
  let response: LanResponse;
  try {
    response = await server.handle(req);
  } catch (error) {
    response = serverError(messageOf(error));
  }
  try {
    httpd.respond(req.id, response);
  } catch (error) {
    httpd.respond(req.id, serverError(messageOf(error)));
  }
}

async function run(): Promise<void> {
  setStatus({ state: 'starting', error: null });
  pairing = createPairing({ store: asyncStorageStore });
  const sources = createLanSources();
  const refreshSources = () => {
    sources.refresh().catch(() => undefined);
  };
  setLanPorts({
    player: createLanPlayer(),
    sources,
    navigator: createLanNavigator(),
    remote: { sendKey: httpd.sendKey, sendText: httpd.sendText, adjustVolume: httpd.adjustVolume },
    env: {
      version: getAppConfig().versionName,
      address: () => (status.port === null ? '' : addressOf(status.port)),
    },
  });
  refreshSources();
  cleanups.push(getBootstrap().subscribe(refreshSources));

  if (Platform.OS === 'android' && Platform.isTV) {
    const getPlayer = () => getLanPorts().player;
    try {
      cleanups.push(startAirPlay({ getPlayer, settings: appSettings }));
    } catch (error) {
      console.warn('AirPlay:', error);
    }
    try {
      cleanups.push(startDlna({ getPlayer, name: () => '' }));
    } catch (error) {
      console.warn('DLNA:', error);
    }
  }

  try {
    if (!httpd.isAvailable()) throw new Error('Httpd native module is not available');
    // Without a file system the File tab is off; the rest of the server still runs.
    const files = await createExpoFileSystem().catch(() => undefined);
    const server = createLanServer(
      {
        pairing,
        settings: appSettings,
        configs: {
          vod: createConfigRepository(asyncStorageStore, 'vod'),
          live: createConfigRepository(asyncStorageStore, 'live'),
        },
        bootstrap: getBootstrap(),
        serverLink: () => (isServerLinkEnabled() ? getServerLink() : undefined),
      },
      files,
    );
    const subscription = httpd.addRequestListener((req) => void forward(server, req));
    cleanups.push(() => subscription.remove());
    const port = await httpd.startServer({ portFrom: LAN_PORT_FROM, portTo: LAN_PORT_TO, mdnsName: LAN_MDNS_NAME });
    setStatus({ state: 'running', port, address: addressOf(port), localName: `http://${LAN_MDNS_NAME}.local:${port}`, error: null });
  } catch (error) {
    setStatus({ state: 'error', error: messageOf(error) });
  }
}

/**
 * Starts the LAN server (phone control page), its ports and, on Android TV, the AirPlay and DLNA
 * receivers. Idempotent; never rejects: failures end up in getLanStatus().error.
 */
export function startLanServices(): Promise<void> {
  started ??= run().catch((error: unknown) => setStatus({ state: 'error', error: messageOf(error) }));
  return started;
}

/** Stops everything startLanServices started; the next start begins from scratch. */
export async function stopLanServices(): Promise<void> {
  const pending = started;
  if (!pending) return;
  await pending;
  started = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
  setLanPorts({ player: null, sources: null, navigator: null, remote: null, env: null });
  pairing = null;
  status = IDLE;
  await httpd.stopServer().catch(() => undefined);
  for (const listener of [...listeners]) listener();
}
