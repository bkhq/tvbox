import { useImperativeHandle } from 'react';

import type { EngineFactory, EngineHandle, EngineKind, EngineViewProps } from '../engine/types';

/** Test double for an engine: renders nothing and records its props and seeks. */
export interface MockEngine extends EngineFactory {
  available: boolean;
  /** Props of the last render; undefined before the first one. */
  props?: EngineViewProps;
  seeks: number[];
  mounts: number;
}

export function createMockEngine(kind: EngineKind, available = true): MockEngine {
  const engine: MockEngine = {
    kind,
    label: kind === 'video' ? '系统播放器' : 'MPV',
    available,
    seeks: [],
    mounts: 0,
    isAvailable: () => engine.available,
    Component: function MockEngineView({ ref, ...props }: EngineViewProps & { ref?: React.Ref<EngineHandle> }) {
      engine.props = props;
      useImperativeHandle(ref, () => {
        engine.mounts += 1;
        return { seek: (ms: number) => engine.seeks.push(ms) };
      }, []);
      return null;
    },
  };
  return engine;
}
