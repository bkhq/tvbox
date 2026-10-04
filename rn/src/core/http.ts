/**
 * Small fetch wrapper: timeout, case-insensitive header merge, text/JSON
 * helpers, an injectable fetch for tests and a request-interceptor registry
 * so other modules can add headers for specific hosts.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Request init as seen by interceptors: headers are always a plain object. */
export interface InterceptedInit extends Omit<RequestInit, 'headers'> {
  headers: Record<string, string>;
}

export type RequestInterceptor = (url: string, init: InterceptedInit) => InterceptedInit;

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /** Milliseconds before the request is aborted; 0 disables. */
  timeout?: number;
  /** Overrides the global fetch (tests). */
  fetch?: FetchLike;
}

export const DEFAULT_TIMEOUT = 15_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

const interceptors: RequestInterceptor[] = [];

/** Registers an interceptor; returns a function that removes it. */
export function addRequestInterceptor(fn: RequestInterceptor): () => void {
  interceptors.push(fn);
  return () => {
    const index = interceptors.indexOf(fn);
    if (index >= 0) interceptors.splice(index, 1);
  };
}

/** Merges header maps left to right; names compare case-insensitively, the later value and spelling win. */
export function mergeHeaders(...maps: (Record<string, string> | undefined)[]): Record<string, string> {
  const result: Record<string, string> = {};
  const names = new Map<string, string>();
  for (const map of maps) {
    if (!map) continue;
    for (const [name, value] of Object.entries(map)) {
      const lower = name.toLowerCase();
      const previous = names.get(lower);
      if (previous !== undefined) delete result[previous];
      names.set(lower, name);
      result[name] = value;
    }
  }
  return result;
}

/** Sends a request; `read` runs inside the timeout so slow bodies are aborted too. */
async function send<T>(url: string, options: RequestOptions, read: (response: Response) => T | Promise<T>): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, fetch: fetchImpl = globalThis.fetch, headers, signal, ...rest } = options;
  let init: InterceptedInit = { ...rest, headers: mergeHeaders(headers) };
  for (const interceptor of [...interceptors]) init = interceptor(url, init);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort);
  }
  const timer = timeout > 0 ? setTimeout(abort, timeout) : undefined;
  try {
    return await read(await fetchImpl(url, { ...init, signal: controller.signal }));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Resolves once headers arrive; the timeout does not cover reading the body. */
export function request(url: string, options: RequestOptions = {}): Promise<Response> {
  return send(url, options, (response) => response);
}

/** GET (by default) and return the body text and final URL; throws HttpError on non-2xx. */
export function fetchText(url: string, options: RequestOptions = {}): Promise<{ text: string; url: string }> {
  return send(url, options, async (response) => {
    if (!response.ok) throw new HttpError(response.status, url);
    return { text: await response.text(), url: response.url || url };
  });
}

export async function getText(url: string, options?: RequestOptions): Promise<string> {
  return (await fetchText(url, options)).text;
}

export async function getJson<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
  return JSON.parse(await getText(url, options)) as T;
}
