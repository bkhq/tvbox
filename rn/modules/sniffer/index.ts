// Hidden WebView that reports every request of a page (native module `Sniffer`).
// Matching lives in JS (src/player/sniff.ts); native code only loads the page,
// runs the rule / click scripts after each page load and emits request URLs.
// One session at a time: start() stops the previous session. Not available
// on tvOS (no WebView there): isSupported() is false.
import { requireOptionalNativeModule } from 'expo';

export interface SnifferRequestEvent {
  id: string;
  url: string;
  /** Request headers when the platform exposes them (Android, iOS navigations); else empty. */
  headers: Record<string, string>;
}

export interface SnifferSubscription {
  remove(): void;
}

export interface SnifferModule {
  isSupported(): boolean;
  /** Loads `url` with `headers`; `scripts` run in order after every page load; the native side gives up after `timeoutMs`. */
  start(id: string, url: string, headers: Record<string, string>, scripts: string[], timeoutMs: number): Promise<void>;
  stop(id: string): Promise<void>;
  addRequestListener(listener: (event: SnifferRequestEvent) => void): SnifferSubscription;
}

interface NativeSniffer {
  isSupported(): boolean;
  start(id: string, url: string, headers: Record<string, string>, scripts: string[], timeoutMs: number): Promise<void>;
  stop(id: string): Promise<void>;
  addListener(event: 'onRequest', listener: (event: SnifferRequestEvent) => void): SnifferSubscription;
}

const native = requireOptionalNativeModule<NativeSniffer>('Sniffer');

const sniffer: SnifferModule | null = native && {
  isSupported: () => native.isSupported(),
  start: (id, url, headers, scripts, timeoutMs) => native.start(id, url, headers, scripts, timeoutMs),
  stop: (id) => native.stop(id),
  addRequestListener: (listener) => native.addListener('onRequest', listener),
};

export default sniffer;
