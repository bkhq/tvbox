/// <reference types="node" />
/**
 * Test-only SpiderRuntime on node `vm`, following the Shared Native Runtime
 * Contract closely enough to run real spider sources in Jest:
 *
 * - one vm context per createContext, host globals __host_http (a sync test
 *   handler), __host_local_* (a Map shared by all contexts, like the
 *   persisted store) and __host_log;
 * - call/evaluate drive promises with the contract loop: flush microtasks,
 *   run `__drainTimers`, wait for the next timer, ERR_QUICKJS_STALLED when
 *   nothing is left, ERR_QUICKJS_TIMEOUT at the deadline (synchronous code
 *   is bounded by the vm `timeout` option);
 * - minimal ESM: modules are rewritten to an async function. Supported:
 *   `import x from`, `import * as x from`, `import { a as b } from`,
 *   `import 'm'`, `export default`, `export function|const|let|var|class`
 *   and `export { a as b }`. Enough for the fixtures and the bundled
 *   cheerio / crypto-js; not a general module system (no live bindings).
 * - module loader: registered sources, bundled libs from
 *   client/modules/quickjs/assets/lib, then http(s) through the http handler.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import type { SpiderRuntime } from '../runtime';

export interface HostResponse {
  code: number | '';
  headers?: Record<string, string | string[]>;
  content: string | Uint8Array;
}

export type HostHttp = (url: string, options: Record<string, unknown>) => HostResponse;

export interface NodeRuntimeOptions {
  http?: HostHttp;
  store?: Map<string, string>;
  log?: (level: string, message: string) => void;
}

export const LIB_DIR = path.resolve(__dirname, '../../../modules/quickjs/assets/lib');

const ERROR_RESPONSE = '{"code":"","headers":{},"content":""}';

class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Context {
  sandbox: vm.Context;
  sources: Map<string, string>;
  modules: Map<string, Promise<Record<string, unknown>>>;
  fetched: Map<string, string>;
}

type Exports = Record<string, unknown>;

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message, stack } = error as { message?: unknown; stack?: unknown };
    if (message !== undefined) return `${String(message)}\n${typeof stack === 'string' ? stack : ''}`;
  }
  return `${String(error)}\n`;
}

function toCoded(error: unknown): CodedError {
  if (error instanceof CodedError) return error;
  if ((error as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return new CodedError('ERR_QUICKJS_TIMEOUT', 'interrupted');
  return new CodedError('ERR_QUICKJS_EXCEPTION', describe(error));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rewrites an ES module into `(async function (__import, __export) { ... })`. */
export function transformModule(source: string): string {
  const names: string[] = [];
  const bindings = (list: string) =>
    list
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [name = '', alias = name] = item.split(/\s+as\s+/);
        return { name: name.trim(), alias: alias.trim() };
      });
  let code = source
    .replace(/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s+(['"][^'"]+['"]);?/gm, (_, ns: string, spec: string) => `const ${ns} = await __import(${spec});`)
    .replace(/^\s*import\s+\{([^}]*)\}\s+from\s+(['"][^'"]+['"]);?/gm, (_, list: string, spec: string) => {
      const parts = bindings(list).map(({ name, alias }) => (name === alias ? name : `${name}: ${alias}`));
      return `const { ${parts.join(', ')} } = await __import(${spec});`;
    })
    .replace(/^\s*import\s+([\w$]+)\s+from\s+(['"][^'"]+['"]);?/gm, (_, name: string, spec: string) => `const ${name} = (await __import(${spec})).default;`)
    .replace(/^\s*import\s+(['"][^'"]+['"]);?/gm, (_, spec: string) => `await __import(${spec});`)
    .replace(/^(\s*)export\s+default\s+/gm, '$1__export.default = ')
    .replace(/^(\s*)export\s+((?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm, (_, indent: string, kind: string, name: string) => {
      names.push(name);
      return `${indent}${kind} ${name}`;
    })
    .replace(/(^|[;}\s])export\s*\{([^}]*)\};?/g, (_, lead: string, list: string) => {
      const assigns = bindings(list).map(({ name, alias }) => `__export[${JSON.stringify(alias)}] = ${name};`);
      return `${lead}${assigns.join(' ')}`;
    });
  code += `\n${names.map((name) => `__export[${JSON.stringify(name)}] = ${name};`).join('\n')}`;
  return `(async function (__import, __export) {"use strict";\n${code}\n})`;
}

/** Loader normalisation of the contract: scheme or lib/ names as is, the rest resolved against the base. */
export function normalizeModuleName(base: string, name: string): string {
  if (/^[a-z][\w+.-]*:\/\//i.test(name) || name.startsWith('lib/')) return name;
  try {
    return new URL(name, base).href;
  } catch {
    return name;
  }
}

export class NodeSpiderRuntime implements SpiderRuntime {
  readonly store: Map<string, string>;
  readonly logs: { level: string; message: string }[] = [];
  readonly contexts = new Map<number, Context>();
  private next = 0;

  constructor(private readonly options: NodeRuntimeOptions = {}) {
    this.store = options.store ?? new Map();
  }

  private hostHttp(url: string, optionsJson: string): string {
    try {
      const options = JSON.parse(optionsJson) as Record<string, unknown>;
      const res = this.options.http?.(url, options);
      if (!res) return ERROR_RESPONSE;
      const bytes = typeof res.content === 'string' ? Buffer.from(res.content, 'utf8') : Buffer.from(res.content);
      const buffer = options.buffer ?? 0;
      const content = buffer === 0 ? bytes.toString('utf8') : bytes.toString('base64');
      return JSON.stringify({ code: res.code, headers: res.headers ?? {}, content });
    } catch {
      return ERROR_RESPONSE;
    }
  }

  private key(rule: string, key: string): string {
    return `cache_${rule ? `${rule}_` : ''}${key}`;
  }

  private get(ctx: number): Context {
    const context = this.contexts.get(ctx);
    if (!context) throw new CodedError('ERR_QUICKJS_NO_CONTEXT', `No context ${ctx}`);
    return context;
  }

  async createContext(): Promise<number> {
    const sandbox = vm.createContext({
      __host_http: (url: string, options: string) => this.hostHttp(url, options),
      __host_local_get: (rule: string, key: string) => this.store.get(this.key(rule, key)) ?? '',
      __host_local_set: (rule: string, key: string, value: string) => void this.store.set(this.key(rule, key), value),
      __host_local_delete: (rule: string, key: string) => void this.store.delete(this.key(rule, key)),
      __host_log: (level: string, message: string) => {
        this.logs.push({ level, message });
        this.options.log?.(level, message);
      },
    });
    const id = ++this.next;
    this.contexts.set(id, { sandbox, sources: new Map(), modules: new Map(), fetched: new Map() });
    return id;
  }

  async registerModule(ctx: number, name: string, source: string): Promise<void> {
    this.get(ctx).sources.set(name, source);
  }

  private source(context: Context, name: string): string {
    const registered = context.sources.get(name);
    if (registered !== undefined) return registered;
    const lib = name.startsWith('assets://js/lib/') ? name.slice('assets://js/lib/'.length) : name.startsWith('lib/') ? name.slice(4) : undefined;
    if (lib !== undefined) {
      const file = path.join(LIB_DIR, lib);
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    }
    if (/^https?:\/\//.test(name)) {
      const cached = context.fetched.get(name);
      if (cached !== undefined) return cached;
      const res = JSON.parse(this.hostHttp(name, '{}')) as { code: number | ''; content: string };
      if (res.code !== '' && res.code < 400) {
        context.fetched.set(name, res.content);
        return res.content;
      }
    }
    throw new Error(`Module not found: ${name}`);
  }

  private runModule(context: Context, name: string, code: string, timeoutMs: number): Promise<Exports> {
    const exports: Exports = {};
    const importer = (spec: string) => this.load(context, normalizeModuleName(name, spec), timeoutMs);
    const fn = vm.runInContext(transformModule(code), context.sandbox, { filename: name, timeout: timeoutMs }) as (
      load: typeof importer,
      target: Exports,
    ) => Promise<void>;
    context.sandbox.__hostRun = () => fn(importer, exports);
    const promise = vm.runInContext('__hostRun()', context.sandbox, { timeout: timeoutMs }) as Promise<void>;
    return Promise.resolve(promise).then(() => exports);
  }

  private load(context: Context, name: string, timeoutMs: number): Promise<Exports> {
    let module = context.modules.get(name);
    if (!module) {
      module = Promise.resolve().then(() => this.runModule(context, name, this.source(context, name), timeoutMs));
      context.modules.set(name, module);
    }
    return module;
  }

  /** The contract's job/timer loop for a pending promise. */
  private async settle(context: Context, promise: PromiseLike<unknown>, deadline: number): Promise<unknown> {
    const state = { done: false, ok: false, value: undefined as unknown };
    promise.then(
      (value) => Object.assign(state, { done: true, ok: true, value }),
      (value: unknown) => Object.assign(state, { done: true, ok: false, value }),
    );
    for (;;) {
      await flush();
      if (!state.done) {
        if (Date.now() >= deadline) throw new CodedError('ERR_QUICKJS_TIMEOUT', 'interrupted');
        let next: number;
        try {
          next = vm.runInContext("typeof __drainTimers === 'function' ? __drainTimers() : -1", context.sandbox, {
            timeout: Math.max(1, deadline - Date.now()),
          }) as number;
        } catch (error) {
          throw toCoded(error);
        }
        await flush();
        if (!state.done) {
          if (next < 0) throw new CodedError('ERR_QUICKJS_STALLED', 'Promise never settles');
          await sleep(Math.min(next, Math.max(0, deadline - Date.now())));
          continue;
        }
      }
      if (state.ok) return state.value;
      throw new CodedError('ERR_QUICKJS_EXCEPTION', describe(state.value));
    }
  }

  async evaluate(ctx: number, code: string, filename: string, asModule: boolean, timeoutMs: number): Promise<void> {
    const context = this.get(ctx);
    const deadline = Date.now() + timeoutMs;
    if (!asModule) {
      try {
        vm.runInContext(code, context.sandbox, { filename, timeout: timeoutMs });
      } catch (error) {
        throw toCoded(error);
      }
      return;
    }
    let promise: Promise<Exports>;
    try {
      promise = this.runModule(context, filename, code, timeoutMs);
    } catch (error) {
      throw toCoded(error);
    }
    await this.settle(context, promise, deadline);
  }

  async call(ctx: number, objectName: string, method: string, argsJson: string, timeoutMs: number): Promise<string> {
    const context = this.get(ctx);
    const deadline = Date.now() + timeoutMs;
    context.sandbox.__hostCall = { objectName, method, argsJson };
    let outcome: { noObject?: true; noFunction?: true; value?: unknown };
    try {
      outcome = vm.runInContext(
        `(function (c) {
          var o = globalThis[c.objectName];
          if ((typeof o !== 'object' && typeof o !== 'function') || o === null) return { noObject: true };
          var f = o[c.method];
          if (typeof f !== 'function') return { noFunction: true };
          return { value: f.apply(o, JSON.parse(c.argsJson)) };
        })(__hostCall)`,
        context.sandbox,
        { timeout: timeoutMs },
      ) as typeof outcome;
    } catch (error) {
      throw toCoded(error);
    }
    if (outcome.noObject) throw new CodedError('ERR_QUICKJS_NO_OBJECT', `${objectName} is not an object`);
    if (outcome.noFunction) return 'null';
    const value = isThenable(outcome.value) ? await this.settle(context, outcome.value, deadline) : outcome.value;
    return JSON.stringify(value) ?? 'null';
  }

  async destroyContext(ctx: number): Promise<void> {
    this.get(ctx);
    this.contexts.delete(ctx);
  }
}
