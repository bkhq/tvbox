import { configApi } from './api/config';
import { controlApi } from './api/control';
import { enrollApi } from './api/enroll';
import { fileApi, fileProcess } from './api/file';
import { pairApi, unpairApi } from './api/pair';
import { sourceApi } from './api/source';
import { stateApi } from './api/state';
import type { LanContext, LanServerDeps } from './context';
import type { FileSystemPort } from './files';
import { getLanPorts } from './ports';
import { notFound, serverError, unauthorized } from './reply';
import { type LanEndpoint, type LanProcess, type LanRequest, type LanResponse, paramsOf } from './types';
import { serveAsset, webAssets } from './web';

export interface LanServer {
  handle(req: LanRequest): Promise<LanResponse>;
  /** Adds or replaces /api/<name>. */
  registerApi(name: string, endpoint: LanEndpoint): void;
  registerProcess(process: LanProcess): void;
  readonly context: LanContext;
}

const API_PREFIX = '/api/';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

/**
 * Nano.serve: auth, then /api/<name>, then processes, then the bundled web UI.
 * With `files`, the File tab routes and /api/file serve that sandbox.
 */
export function createLanServer(deps: LanServerDeps, files?: FileSystemPort): LanServer {
  const context: LanContext = {
    ports: getLanPorts,
    settingsProvider: () => [],
    assets: webAssets,
    ...deps,
  };
  const endpoints = new Map<string, LanEndpoint>([
    ['pair', pairApi(context)],
    ['unpair', unpairApi(context)],
    ['state', stateApi(context)],
    ['config', configApi(context)],
    ['source', sourceApi(context)],
    ['control', controlApi(context)],
    ['enroll', enrollApi(context)],
  ]);
  const processes: LanProcess[] = [];
  if (files) {
    endpoints.set('file', fileApi(context, files));
    processes.push(fileProcess(files));
  }

  async function run(fn: () => LanResponse | Promise<LanResponse>): Promise<LanResponse> {
    try {
      return await fn();
    } catch (error) {
      return serverError(messageOf(error));
    }
  }

  return {
    context,
    async handle(req) {
      const path = req.path.trim();
      const request = path === req.path ? req : { ...req, path };
      await context.pairing.ready;
      if (!context.pairing.allow(request)) return unauthorized('Unauthorized');
      const params = paramsOf(request);
      if (path.startsWith(API_PREFIX)) {
        const endpoint = endpoints.get(path.slice(API_PREFIX.length));
        if (!endpoint) return notFound('Unknown api');
        return run(() => endpoint(request, params));
      }
      const process = processes.find((item) => item.matches(path));
      if (process) return run(() => process.handle(request, params));
      return serveAsset(path, context.assets);
    },
    registerApi(name, endpoint) {
      endpoints.set(name, endpoint);
    },
    registerProcess(process) {
      processes.push(process);
    },
  };
}
