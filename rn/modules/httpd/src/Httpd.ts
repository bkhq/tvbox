import { requireOptionalNativeModule } from 'expo';

import type {
  HttpdKey,
  HttpdRequest,
  HttpdResponse,
  HttpdStartOptions,
  HttpdSubscription,
  HttpdVolumeDirection,
} from './Httpd.types';

interface HttpdNativeModule {
  startServer(portFrom: number, portTo: number, mdnsName: string | null): Promise<number>;
  stopServer(): Promise<void>;
  respond(id: string, response: HttpdResponse): void;
  getLocalIpAddress(): string | null;
  sendKey(key: HttpdKey): Promise<boolean>;
  sendText(text: string): Promise<boolean>;
  adjustVolume(direction: HttpdVolumeDirection): Promise<boolean>;
  addListener(eventName: 'onRequest', listener: (request: HttpdRequest) => void): HttpdSubscription;
}

const native = requireOptionalNativeModule<HttpdNativeModule>('Httpd');

const KEYS: readonly HttpdKey[] = ['up', 'down', 'left', 'right', 'ok', 'back', 'menu'];
const VOLUME_DIRECTIONS: readonly HttpdVolumeDirection[] = ['up', 'down', 'mute'];

const isPort = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 65535;

export function isAvailable(): boolean {
  return native != null;
}

export async function startServer(options: HttpdStartOptions): Promise<number> {
  const { portFrom, portTo, mdnsName } = options;
  if (!isPort(portFrom) || !isPort(portTo) || portFrom > portTo) {
    throw new RangeError(`Invalid port range ${portFrom}..${portTo}`);
  }
  if (mdnsName !== undefined && !/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(mdnsName)) {
    throw new RangeError(`Invalid mDNS name "${mdnsName}"`);
  }
  if (!native) throw new Error('Httpd native module is not available');
  return native.startServer(portFrom, portTo, mdnsName ?? null);
}

export async function stopServer(): Promise<void> {
  await native?.stopServer();
}

export function respond(id: string, response: HttpdResponse): void {
  const { status } = response;
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new RangeError(`Invalid HTTP status ${status}`);
  }
  native?.respond(id, response);
}

export function addRequestListener(listener: (request: HttpdRequest) => void): HttpdSubscription {
  return native?.addListener('onRequest', listener) ?? { remove() {} };
}

export function getLocalIpAddress(): string | null {
  return native?.getLocalIpAddress() ?? null;
}

export async function sendKey(key: HttpdKey): Promise<boolean> {
  if (!KEYS.includes(key)) throw new RangeError(`Unknown key "${key}"`);
  return native ? native.sendKey(key) : false;
}

export async function sendText(text: string): Promise<boolean> {
  return native ? native.sendText(text) : false;
}

export async function adjustVolume(direction: HttpdVolumeDirection): Promise<boolean> {
  if (!VOLUME_DIRECTIONS.includes(direction)) {
    throw new RangeError(`Unknown volume direction "${direction}"`);
  }
  return native ? native.adjustVolume(direction) : false;
}
