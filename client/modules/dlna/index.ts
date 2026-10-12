import { requireOptionalNativeModule } from 'expo';

/** Positions are milliseconds; volume is 0-100. */
export type DlnaCastEvent =
  | { type: 'play'; url: string; title?: string; position?: number; headers?: Record<string, string> }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'seek'; position: number }
  | { type: 'volume'; volume: number }
  | { type: 'mute'; mute: boolean };

export interface DlnaSubscription {
  remove(): void;
}

export interface DlnaPlaybackState {
  /** Milliseconds. */
  position: number;
  /** Milliseconds. */
  duration: number;
  playing: boolean;
  /** The cast media finished (or the player closed); advances to SetNextAVTransportURI when queued. */
  ended?: boolean;
}

export interface DlnaModule {
  /** True only on Android TV with the native module linked. */
  isSupported(): boolean;
  /** Starts the renderer, renaming it when it already runs; an empty name uses the device name. No-op off TV. */
  start(options: { name: string }): Promise<void>;
  stop(): Promise<void>;
  /** AVTransport commands from the control point; volume and mute are already applied to the system stream. */
  addCastListener(listener: (event: DlnaCastEvent) => void): DlnaSubscription;
  /** Player state served to the control point (GetPositionInfo, GetTransportInfo, LastChange). */
  updatePlayback(state: DlnaPlaybackState): void;
}

interface NativeDlna {
  addListener(event: 'onCast', listener: (event: DlnaCastEvent) => void): DlnaSubscription;
  isSupported(): boolean;
  start(name: string): Promise<void>;
  stop(): Promise<void>;
  updatePlayback(position: number, duration: number, playing: boolean, ended: boolean): void;
}

// Android only: null on iOS / tvOS and in Jest.
const native = requireOptionalNativeModule<NativeDlna>('Dlna');

const dlna: DlnaModule = {
  isSupported: () => native?.isSupported() ?? false,
  start: async ({ name }) => {
    await native?.start(name);
  },
  stop: async () => {
    await native?.stop();
  },
  addCastListener: (listener) => native?.addListener('onCast', listener) ?? { remove: () => {} },
  updatePlayback: ({ position, duration, playing, ended = false }) =>
    native?.updatePlayback(position, duration, playing, ended),
};

export default dlna;
