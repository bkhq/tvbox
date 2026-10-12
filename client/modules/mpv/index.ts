import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, RefAttributes } from 'react';

import type { MpvViewHandle, MpvViewProps } from './src/Mpv.types';

export * from './src/Mpv.types';

interface MpvNativeModule {
  isAvailable(): boolean;
}

type MpvNativeView = ComponentType<MpvViewProps & RefAttributes<MpvViewHandle>>;

const nativeModule = requireOptionalNativeModule<MpvNativeModule>('Mpv');
let nativeView: MpvNativeView | undefined;

/**
 * True when the module is linked and libmpv loads: false in Jest and on web, on Android
 * ABIs without libmpv (x86 / x86_64) and on iOS builds without the MPVKit frameworks.
 */
export function isMpvAvailable(): boolean {
  try {
    return nativeModule?.isAvailable() === true;
  } catch {
    return false;
  }
}

/** The native view, or undefined when the module is not linked. */
export function getMpvView(): MpvNativeView | undefined {
  if (!nativeModule) return undefined;
  nativeView ??= requireNativeView<MpvViewProps>('Mpv') as MpvNativeView;
  return nativeView;
}
