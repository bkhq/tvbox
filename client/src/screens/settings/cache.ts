import type * as ExpoFileSystem from 'expo-file-system';

/** Size and cleanup of the app cache directory; expo-file-system loads on first use. */

type FileSystem = Pick<typeof ExpoFileSystem, 'Directory' | 'Paths'>;
type Directory = InstanceType<FileSystem['Directory']>;

const loadFileSystem = (): Promise<FileSystem> => import('expo-file-system');

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

function directorySize(dir: Directory, fs: FileSystem): number {
  let total = 0;
  for (const item of dir.list()) total += item instanceof fs.Directory ? directorySize(item, fs) : (item.size ?? 0);
  return total;
}

/** Total bytes of the files under Paths.cache, recursively. */
export async function getCacheSize(load = loadFileSystem): Promise<number> {
  const fs = await load();
  return directorySize(fs.Paths.cache, fs);
}

/** Deletes everything inside Paths.cache, keeping the directory itself. */
export async function clearCache(load = loadFileSystem): Promise<void> {
  const { Paths } = await load();
  for (const item of Paths.cache.list()) item.delete();
}
