import { InvalidSettingValueError, type SettingRegistry } from '../settingRegistry';
import { badRequest, ok } from '../reply';
import type { LanEndpoint } from '../types';

/** SettingApi: changes one setting described by the registry. */
export const settingApi =
  (registry: SettingRegistry): LanEndpoint =>
  async (_req, params) => {
    try {
      return (await registry.set(params.key ?? '', params.value ?? '')) ? ok() : badRequest('Unknown key');
    } catch (error) {
      if (error instanceof InvalidSettingValueError) return badRequest(error.message);
      throw error;
    }
  };
