import type { EngineFactory, EngineKind } from './types';

/**
 * Engine registry. Engine workstreams register a factory at startup; the
 * player picks one with resolveEngine and falls back with fallbackEngine.
 */

const engines = new Map<EngineKind, EngineFactory>();

/** Registers (or replaces) the factory for its kind; returns an unregister function. */
export function registerEngine(factory: EngineFactory): () => void {
  engines.set(factory.kind, factory);
  return () => {
    if (engines.get(factory.kind) === factory) engines.delete(factory.kind);
  };
}

export function getEngine(kind: EngineKind): EngineFactory | undefined {
  return engines.get(kind);
}

export function listEngines(): EngineFactory[] {
  return [...engines.values()];
}

function available(kind: EngineKind): EngineFactory | undefined {
  const factory = engines.get(kind);
  return factory?.isAvailable() ? factory : undefined;
}

function other(kind: EngineKind): EngineKind {
  return kind === 'video' ? 'mpv' : 'video';
}

/** The preferred engine when registered and available, else the other one. */
export function resolveEngine(preferred: EngineKind): EngineFactory | undefined {
  return available(preferred) ?? available(other(preferred));
}

/** The other available engine after `failed` could not play. */
export function fallbackEngine(failed: EngineKind): EngineFactory | undefined {
  return available(other(failed));
}

/** Test helper. */
export function clearEngines(): void {
  engines.clear();
}
