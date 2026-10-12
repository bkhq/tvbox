import { getRandomBytes } from 'expo-crypto';

import { jsonCell, storageKey } from '../core/storage/json';
import type { KeyValueStore } from '../core/storage/keyValueStore';
import { isObject, num, str } from '../core/types';
import { paramsOf, type LanRequest } from './types';

/** Paired phones and the pairing code (Pairing.java). */

export interface Device {
  token: string;
  name: string;
  agent: string;
  ip: string;
  /** Pairing time, epoch ms. */
  time: number;
  /** Last authorised request, epoch ms. */
  last: number;
}

export interface Pairing {
  /** Resolves once the saved devices are loaded. */
  readonly ready: Promise<void>;
  getCode(): string;
  refreshCode(): void;
  devices(): readonly Device[];
  /** Null when the code is wrong; otherwise a new device, and the code rotates. */
  pair(code: string | undefined, name: string | undefined, agent: string | undefined, ip: string): Promise<Device | null>;
  unpair(token: string): Promise<boolean>;
  find(token: string | undefined): Device | undefined;
  /** Whether the request may reach `req.path`; a known token refreshes the device's ip and last access. */
  allow(req: LanRequest): boolean;
  /** Called on code and device list changes. */
  subscribe(listener: () => void): () => void;
}

export interface PairingDeps {
  store: KeyValueStore;
  randomBytes?: (n: number) => Uint8Array;
  now?: () => number;
}

export const PAIRED_DEVICES_KEY = storageKey('lan.pairedDevices', 1);
const TOKEN_HEADER = 'x-token';
const PROTECTED = ['/api/', '/action', '/file', '/upload', '/newFolder', '/delFolder', '/delFile'];
const LOCAL = new Set(['127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);
const TOUCH_INTERVAL = 60_000;

function parseDevices(raw: unknown): Device[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((item) => ({
      token: str(item.token),
      name: str(item.name),
      agent: str(item.agent),
      ip: str(item.ip),
      time: num(item.time),
      last: num(item.last),
    }))
    .filter((device) => device.token !== '');
}

/** The caller's token: X-Token header, else the token parameter. */
export function tokenOf(req: LanRequest): string | undefined {
  return req.headers[TOKEN_HEADER] || paramsOf(req).token || undefined;
}

export function isLocalAddress(ip: string): boolean {
  return LOCAL.has(ip);
}

export function isProtectedPath(path: string): boolean {
  if (path === '/api/pair') return false;
  return PROTECTED.some((prefix) => path.startsWith(prefix));
}

export function createPairing(deps: PairingDeps): Pairing {
  const randomBytes = deps.randomBytes ?? getRandomBytes;
  const now = deps.now ?? Date.now;
  const cell = jsonCell(deps.store, PAIRED_DEVICES_KEY, parseDevices);
  const listeners = new Set<() => void>();
  let devices: Device[] = [];
  let code = '';

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const save = () => {
    const snapshot = devices;
    return cell.update(() => ({ value: snapshot, result: undefined }));
  };

  /** Uniform 6-digit code; rejection sampling avoids modulo bias. */
  const newCode = () => {
    const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
    for (;;) {
      const [a = 0, b = 0, c = 0, d = 0] = randomBytes(4);
      const value = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
      if (value < limit) return String(value % 1_000_000).padStart(6, '0');
    }
  };

  const newToken = () => Array.from(randomBytes(24), (byte) => byte.toString(16).padStart(2, '0')).join('');

  const pairing: Pairing = {
    ready: cell.read().then(
      (saved) => {
        // Devices paired before the load finished stay.
        devices = [...saved.filter((item) => !devices.some((device) => device.token === item.token)), ...devices];
        emit();
      },
      () => undefined,
    ),
    getCode: () => code,
    refreshCode() {
      code = newCode();
      emit();
    },
    devices: () => devices,
    async pair(input, name, agent, ip) {
      if (!input || input !== code) return null;
      const time = now();
      const device: Device = { token: newToken(), name: name || ip, agent: agent ?? '', ip, time, last: time };
      devices = [...devices, device];
      pairing.refreshCode();
      await save();
      return device;
    },
    async unpair(token) {
      const next = devices.filter((device) => device.token !== token);
      if (next.length === devices.length) return false;
      devices = next;
      emit();
      await save();
      return true;
    },
    find: (token) => (token ? devices.find((device) => device.token === token) : undefined),
    allow(req) {
      if (isLocalAddress(req.remoteAddress)) return true;
      if (!isProtectedPath(req.path)) return true;
      const device = pairing.find(tokenOf(req));
      if (!device) return false;
      const time = now();
      const stale = time - device.last > TOUCH_INTERVAL || device.ip !== req.remoteAddress;
      const touched = { ...device, ip: req.remoteAddress, last: time };
      devices = devices.map((item) => (item === device ? touched : item));
      if (stale) {
        void save().catch(() => undefined);
        emit();
      }
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  code = newCode();
  return pairing;
}
