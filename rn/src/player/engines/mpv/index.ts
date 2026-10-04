import { isMpvAvailable } from '../../../../modules/mpv';
import type { EngineFactory } from '../../engine/types';
import { MpvEngineView } from './MpvEngineView';

export { classifyMpvError, createMpvEventMapper, toNativeProps, toTracks, trackSelection } from './mapping';
export { MpvEngineView } from './MpvEngineView';

export const mpvEngineFactory: EngineFactory = {
  kind: 'mpv',
  label: 'MPV',
  isAvailable: isMpvAvailable,
  Component: MpvEngineView,
};
