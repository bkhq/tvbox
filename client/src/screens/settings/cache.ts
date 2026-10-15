import type * as ExpoFileSystem from 'expo-file-system';
import type * as LegacyFileSystem from 'expo-file-system/legacy';

/** Size and cleanup of the app cache directory; expo-file-system loads on first use. */

type FileSystem = Pick<typeof ExpoFileSystem, 'Directory' | 'Paths'>;

type InfoFileSystem = Pick<typeof LegacyFileSystem, 'cacheDirectory' | 'getInfoAsync'>;

const loadFileSystem = (): Promise<FileSystem> => import('expo-file-system');
const loadInfoFileSystem = (): Promise<InfoFileSystem> => import('expo-file-system/legacy');

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Binary units with one decimal below 10: "0 B", "512 KB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit > 0 && value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${UNITS[unit]}`;
}

/**
 * Total bytes of the files under the cache directory, recursively. The native side walks the tree off the JS
 * thread: walking it from JS took seconds with a full image cache and stalled opening 设置.
 */
export async function getCacheSize(load = loadInfoFileSystem): Promise<number> {
  const { cacheDirectory, getInfoAsync } = await load();
  if (!cacheDirectory) return 0;
  const info = await getInfoAsync(cacheDirectory);
  return info.exists ? info.size : 0;
}

/** Deletes everything inside Paths.cache, keeping the directory itself. */
export async function clearCache(load = loadFileSystem): Promise<void> {
  const { Paths } = await load();
  for (const item of Paths.cache.list()) item.delete();
}
