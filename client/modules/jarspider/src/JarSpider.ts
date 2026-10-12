import { requireOptionalNativeModule } from 'expo';

import type { JarSpiderNative } from './JarSpider.types';

// Android only: null on iOS / tvOS, web and in Jest.
export const JarSpider: JarSpiderNative | null = requireOptionalNativeModule<JarSpiderNative>('JarSpider');

export function isJarSpiderAvailable(): boolean {
  return JarSpider !== null;
}
