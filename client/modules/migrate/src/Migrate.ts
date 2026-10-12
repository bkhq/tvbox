import { requireOptionalNativeModule } from 'expo';

import type { LegacyReader } from './Migrate.types';

interface MigrateNativeModule extends LegacyReader {
  getAbiFlavor(): string;
  sha256File(uri: string): Promise<string>;
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
