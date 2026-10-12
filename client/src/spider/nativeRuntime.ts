/**
 * SpiderRuntime backed by the QuickJS native module (client/modules/quickjs).
 * Calls pass straight through; native rejections (Expo CodedError with an
 * ERR_QUICKJS_* code) become SpiderError / SpiderTimeoutError.
 */

import QuickJS from '../../modules/quickjs';
import { registerJsSpiderProvider } from './index';
import { setSpiderRuntime, type SpiderRuntime, toSpiderError } from './runtime';

function mapped<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    throw toSpiderError(error);
  });
}

export const nativeSpiderRuntime: SpiderRuntime = {
  createContext: () => mapped(QuickJS.createContext()),
  registerModule: (ctx, name, source) => mapped(QuickJS.registerModule(ctx, name, source)),
  evaluate: (ctx, code, filename, asModule, timeoutMs) => mapped(QuickJS.evaluate(ctx, code, filename, asModule, timeoutMs)),
  call: (ctx, objectName, method, argsJson, timeoutMs) => mapped(QuickJS.call(ctx, objectName, method, argsJson, timeoutMs)),
  destroyContext: (ctx) => mapped(QuickJS.destroyContext(ctx)),
};

let installed = false;

/** Installs the native runtime and registers the JS spider provider; later calls are no-ops. */
export function installJsSpiders(): void {
  if (installed) return;
  installed = true;
  setSpiderRuntime(nativeSpiderRuntime);
  registerJsSpiderProvider();
}
