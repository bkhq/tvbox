import { requireOptionalNativeModule } from 'expo';

/** Positions are milliseconds. */
export type AirPlayCastEvent =
  | { type: 'play'; url: string; position: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'seek'; position: number };

export interface AirPlaySubscription {
  remove(): void;
}

export interface AirPlayPlaybackState {
  /** Milliseconds. */
  position: number;
  /** Milliseconds. */
  duration: number;
  playing: boolean;
  rate: number;
}

export interface AirPlayModule {
  /** True only on Android TV with the native module linked. */
  isSupported(): boolean;
  /** Starts the receiver, restarting it under a new name; no-op off TV. */
  start(options: { name: string }): Promise<void>;
  stop(): Promise<void>;
  /** HLS / URL casts from the sender. Mirroring stays native. */
  addCastListener(listener: (event: AirPlayCastEvent) => void): AirPlaySubscription;
  /** Player state served to the sender (progress, scrubbing, play/pause). */
  updatePlayback(state: AirPlayPlaybackState): void;
}

interface NativeAirPlay {
  addListener(event: 'onCast', listener: (event: AirPlayCastEvent) => void): AirPlaySubscription;
  isSupported(): boolean;
  start(name: string): Promise<void>;
  stop(): Promise<void>;
  updatePlayback(position: number, duration: number, playing: boolean, rate: number): void;
}

// Android only: null on iOS / tvOS and in Jest.
const native = requireOptionalNativeModule<NativeAirPlay>('AirPlay');

const airplay: AirPlayModule = {
  isSupported: () => native?.isSupported() ?? false,
  start: async ({ name }) => {
    await native?.start(name);
  },
  stop: async () => {
    await native?.stop();
  },
  addCastListener: (listener) => native?.addListener('onCast', listener) ?? { remove: () => {} },
  updatePlayback: ({ position, duration, playing, rate }) => native?.updatePlayback(position, duration, playing, rate),
};

export default airplay;
