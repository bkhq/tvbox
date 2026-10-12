import { registerEngine } from '../engine/registry';
import { mpvEngineFactory } from './mpv';
import { videoEngineFactory } from './video';

export { mpvEngineFactory } from './mpv';

/** Registers the engines bundled with the app; call once at startup. */
export function registerBuiltinEngines(): void {
  registerEngine(videoEngineFactory);
  registerEngine(mpvEngineFactory);
}
