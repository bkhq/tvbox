import { requireNativeModule } from 'expo';

export interface QuickJSNative {
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

const QuickJS = requireNativeModule<QuickJSNative>('QuickJS');
export default QuickJS;
