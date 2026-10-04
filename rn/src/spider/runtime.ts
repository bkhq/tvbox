/**
 * JS engine seam for spiders. The app installs the QuickJS native module
 * (rn/modules/quickjs) with setSpiderRuntime; tests install a node `vm`
 * runtime. The shape is identical to the native module's QuickJSNative, so
 * the native module can be passed as is.
 */

export interface SpiderRuntime {
  /** New isolated JSRuntime+JSContext on its own serial thread; host globals installed. */
  createContext(): Promise<number>;
  /** Adds/overrides a module source used by the module loader (exact name match). */
  registerModule(ctx: number, name: string, source: string): Promise<void>;
  /** Script (asModule=false, global eval) or ES module (name = filename). */
  evaluate(ctx: number, code: string, filename: string, asModule: boolean, timeoutMs: number): Promise<void>;
  /** Calls globalThis[objectName][method](...JSON.parse(argsJson)); resolves JSON.stringify(result). */
  call(ctx: number, objectName: string, method: string, argsJson: string, timeoutMs: number): Promise<string>;
  destroyContext(ctx: number): Promise<void>;
}

/** Error codes rejected by the native runtime. */
export const SPIDER_ERROR_CODES = [
  'ERR_QUICKJS_EXCEPTION',
  'ERR_QUICKJS_TIMEOUT',
  'ERR_QUICKJS_STALLED',
  'ERR_QUICKJS_NO_OBJECT',
  'ERR_QUICKJS_NO_CONTEXT',
] as const;

export type QuickJSErrorCode = (typeof SPIDER_ERROR_CODES)[number];

/** Codes raised on the TS side. */
export type SpiderErrorCode = QuickJSErrorCode | 'ERR_SPIDER_RUNTIME' | 'ERR_SPIDER_LOAD' | 'ERR_SPIDER_DESTROYED';

export class SpiderError extends Error {
  constructor(
    readonly code: SpiderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpiderError';
  }
}

export class SpiderTimeoutError extends SpiderError {
  constructor(message: string) {
    super('ERR_QUICKJS_TIMEOUT', message);
    this.name = 'SpiderTimeoutError';
  }
}

function isQuickJSCode(code: unknown): code is QuickJSErrorCode {
  return typeof code === 'string' && (SPIDER_ERROR_CODES as readonly string[]).includes(code);
}

/** Maps a native rejection (Expo CodedError: `code` + `message`) to SpiderError / SpiderTimeoutError. */
export function toSpiderError(error: unknown): SpiderError {
  if (error instanceof SpiderError) return error;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'ERR_QUICKJS_TIMEOUT') return new SpiderTimeoutError(message);
  return new SpiderError(isQuickJSCode(code) ? code : 'ERR_SPIDER_RUNTIME', message);
}

let current: SpiderRuntime | undefined;

/** Installs the engine; pass undefined to clear it (tests). */
export function setSpiderRuntime(runtime: SpiderRuntime | undefined): void {
  current = runtime;
}

export function getSpiderRuntime(): SpiderRuntime {
  if (!current) {
    throw new SpiderError('ERR_SPIDER_RUNTIME', 'No JS spider runtime installed; call setSpiderRuntime() with the QuickJS module first');
  }
  return current;
}
