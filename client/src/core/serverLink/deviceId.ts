import { getRandomBytes } from 'expo-crypto';

import { asyncStorageStore, type KeyValueStore, storageKey } from '../storage';

export type RandomBytes = (count: number) => Uint8Array;

export const DEVICE_ID_KEY = storageKey('deviceId', 1);

/** Random locally administered unicast MAC, e.g. "02:AB:CD:EF:01:23" (DeviceId.java). */
export function newDeviceId(random: RandomBytes = getRandomBytes): string {
  const mac = Array.from(random(6));
  mac[0] = ((mac[0] ?? 0) | 0x02) & 0xfe;
  return mac.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

const pending = new WeakMap<KeyValueStore, Promise<string>>();

/** Random, persistent id for this install; shared by server link and AirPlay. */
export function getDeviceId(store: KeyValueStore = asyncStorageStore, random: RandomBytes = getRandomBytes): Promise<string> {
  let id = pending.get(store);
  if (!id) {
    id = (async () => {
      const saved = await store.getItem(DEVICE_ID_KEY);
      if (saved) return saved;
      const created = newDeviceId(random);
      await store.setItem(DEVICE_ID_KEY, created);
      return created;
    })();
    id.catch(() => pending.delete(store));
    pending.set(store, id);
  }
  return id;
}
