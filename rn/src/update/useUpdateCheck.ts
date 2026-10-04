import { useSyncExternalStore } from 'react';

import type { UpdateController, UpdateState } from './controller';
import { getUpdateController } from './updater';

export interface UseUpdateCheck extends UpdateState {
  check: UpdateController['check'];
  install: UpdateController['install'];
  dismiss: UpdateController['dismiss'];
}

export function useUpdateCheck(controller: UpdateController = getUpdateController()): UseUpdateCheck {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return { ...state, check: controller.check, install: controller.install, dismiss: controller.dismiss };
}
