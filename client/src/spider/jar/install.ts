import { Platform } from 'react-native';

import { JarSpider, type JarSpiderNative } from '../../../modules/jarspider';
import type { VodConfig } from '../../core/config';
import { setJarSitesSupported } from '../../core/config/vodConfig';
import { registerProvider } from '../../core/provider';
import { createJarSpiderProviderFactory } from './provider';

let installed: JarSpiderNative | undefined;

/**
 * Android with the JarSpider module: JAR sites become supported and get the
 * JAR provider. Elsewhere a no-op, so JAR sites stay "不支持". Later calls are no-ops.
 */
export function installJarSpiders(os: string = Platform.OS, native: JarSpiderNative | null = JarSpider): void {
  if (installed || os !== 'android' || !native) return;
  installed = native;
  setJarSitesSupported(true);
  registerProvider(createJarSpiderProviderFactory(native));
}

/** The module installJarSpiders enabled; undefined off Android or before install. */
export function getInstalledJarSpider(): JarSpiderNative | undefined {
  return installed;
}

/**
 * After a VOD config load (providers already cleared): JarLoader.clear(), then
 * warms the config JAR in the background, making it recent only while current.
 */
export async function onJarConfigLoaded(config: Pick<VodConfig, 'spider'>, isCurrent: () => boolean = () => true): Promise<void> {
  const native = installed;
  if (!native) return;
  await native.clear().catch(() => undefined);
  if (config.spider !== '' && isCurrent()) {
    void native.loadJar(config.spider, false).then((loaded) => {
      if (loaded && isCurrent()) native.setRecent(config.spider);
    }).catch(() => undefined);
  }
}

/** Test helper: forgets the installed module and disables JAR sites again. */
export function resetJarSpidersForTest(): void {
  installed = undefined;
  setJarSitesSupported(false);
}
