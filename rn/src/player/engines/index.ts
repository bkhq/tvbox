import { registerEngine } from '../engine/registry';
import { videoEngineFactory } from './video';

/** Registers the engines bundled with the app; call once at startup. */
export function registerBuiltinEngines(): void {
  registerEngine(videoEngineFactory);
}
