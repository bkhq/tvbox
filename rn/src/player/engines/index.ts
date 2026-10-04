import { registerEngine } from '../engine';
import { mpvEngineFactory } from './mpv';

export { mpvEngineFactory } from './mpv';

/** Registers the engine implementations; call once at startup. */
export function registerEngines(): void {
  registerEngine(mpvEngineFactory);
}
