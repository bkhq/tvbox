/**
 * App-wide update state shared by the launch prompt and the settings item.
 * Pure: the platform, config, fetch and install side effects are injected.
 */

import { installUpdate, type InstallDeps, type InstallResult } from './install';
import { checkForUpdate, type CheckResult, type FetchJson, type Release, type UpdatePlatform } from './logic';

export type InstallPhase =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: number | null }
  | { phase: 'installing' }
  | { phase: 'manual'; reason: Extract<InstallResult, { status: 'manual' }>['reason'] }
  | { phase: 'error'; error: unknown };

export interface UpdateState {
  checking: boolean;
  /** Result of the last manual check, shown by the settings item. */
  lastResult: CheckResult | null;
  /** Release shown in the dialog; null when the dialog is closed. */
  release: Release | null;
  installState: InstallPhase;
}

export interface UpdateControllerDeps {
  workerUrl: string;
  versionCode: number;
  platform: UpdatePlatform;
  fetchJson: FetchJson;
  install: InstallDeps;
}

export interface UpdateController {
  getState(): UpdateState;
  subscribe(listener: () => void): () => void;
  check(manual: boolean): Promise<CheckResult>;
  install(): Promise<void>;
  /** Closes the dialog; cancels a running download. */
  dismiss(): void;
}

const initialState: UpdateState = { checking: false, lastResult: null, release: null, installState: { phase: 'idle' } };

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  let state = initialState;
  let checks = 0;
  let download: AbortController | null = null;
  const listeners = new Set<() => void>();

  const update = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const busy = () => state.installState.phase === 'downloading' || state.installState.phase === 'installing';

  async function run(manual: boolean): Promise<CheckResult> {
    checks += 1;
    update({ checking: true });
    const result = await checkForUpdate({ ...deps, manual });
    checks -= 1;
    const patch: Partial<UpdateState> = { checking: checks > 0 };
    if (manual) patch.lastResult = result;
    if (result.status === 'available' && !busy()) {
      patch.release = result.release;
      patch.installState = { phase: 'idle' };
    }
    update(patch);
    return result;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check: run,
    async install() {
      const release = state.release;
      if (!release || busy()) return;
      const controller = new AbortController();
      download = controller;
      update({ installState: { phase: 'downloading', progress: null } });
      try {
        const result = await installUpdate(release, deps.install, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) update({ installState: { phase: 'downloading', progress } });
          },
          onDownloaded: () => update({ installState: { phase: 'installing' } }),
        });
        if (controller.signal.aborted) return;
        update(result.status === 'manual' ? { installState: { phase: 'manual', reason: result.reason } } : { release: null, installState: { phase: 'idle' } });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Update install failed', error);
        update({ installState: { phase: 'error', error } });
      } finally {
        if (download === controller) download = null;
      }
    },
    dismiss() {
      download?.abort();
      download = null;
      update({ release: null, installState: { phase: 'idle' } });
    },
  };
}
