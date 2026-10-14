import { requireOptionalNativeModule } from 'expo';

import type { LegacyReader } from './Migrate.types';

interface DownloadProgressEvent {
  id: string;
  bytes: number;
  total: number;
}

interface MigrateNativeModule extends LegacyReader {
  getAbiFlavor(): string;
  sha256File(uri: string): Promise<string>;
  downloadFile(id: string, url: string, uri: string, threads: number): Promise<number>;
  cancelDownload(id: string): void;
  addListener(event: 'onDownloadProgress', listener: (event: DownloadProgressEvent) => void): { remove(): void };
}

const native = requireOptionalNativeModule<MigrateNativeModule>('Migrate');

/** Reader of the Java app's data; null where the native module is absent (iOS, tvOS, tests). */
export const legacyReader: LegacyReader | null = native;

/** ABI flavor this APK was built for (string resource tvbox_abi_flavor); "" when unknown. */
export function getAbiFlavor(): string {
  return native?.getAbiFlavor() ?? '';
}

/** Lowercase hex SHA-256 of a file:// URI or path, hashed natively; null where the native module is absent. */
export const sha256File: ((uri: string) => Promise<string>) | null = native ? (uri) => native.sha256File(uri) : null;

/** Parallel byte-range download; resolves with the file size. `total` is -1 when unknown. */
export type DownloadFile = (
  url: string,
  uri: string,
  options: { threads: number; onProgress: (bytes: number, total: number) => void; signal?: AbortSignal },
) => Promise<number>;

let downloads = 0;

/** Native parallel downloader; null where the native module is absent. */
export const downloadFile: DownloadFile | null = native
  ? async (url, uri, { threads, onProgress, signal }) => {
      const id = `dl-${Date.now()}-${(downloads += 1)}`;
      const subscription = native.addListener('onDownloadProgress', (event) => {
        if (event.id === id) onProgress(event.bytes, event.total);
      });
      const cancel = () => native.cancelDownload(id);
      signal?.addEventListener('abort', cancel);
      try {
        return await native.downloadFile(id, url, uri, threads);
      } finally {
        signal?.removeEventListener('abort', cancel);
        subscription.remove();
      }
    }
  : null;
