import { requireOptionalNativeModule } from 'expo';

import type { LegacyReader } from './Migrate.types';

interface MigrateNativeModule extends LegacyReader {
  getAbiFlavor(): string;
}

const native = requireOptionalNativeModule<MigrateNativeModule>('Migrate');

/** Reader of the Java app's data; null where the native module is absent (iOS, tvOS, tests). */
export const legacyReader: LegacyReader | null = native;

/** ABI flavor this APK was built for (string resource tvbox_abi_flavor); "" when unknown. */
export function getAbiFlavor(): string {
  return native?.getAbiFlavor() ?? '';
}
