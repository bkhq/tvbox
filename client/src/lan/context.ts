import type { Bootstrap } from '../core/bootstrap';
import type { ServerLink } from '../core/serverLink/serverLink';
import type { SettingsStore } from '../core/settings/settings';
import type { ConfigRepository } from '../core/storage/configs';
import type { Pairing } from './pairing';
import type { LanPorts } from './ports';
import type { WebAsset } from './web/assets.generated';

/** Everything the LAN core needs from the app; injected so tests run on MemoryStore and fakes. */
export interface LanServerDeps {
  pairing: Pairing;
  /** Defaults to getLanPorts. */
  ports?: () => LanPorts;
  settings: Pick<SettingsStore, 'get' | 'set'>;
  configs: { vod: ConfigRepository; live: ConfigRepository };
  bootstrap: Pick<Bootstrap, 'getSnapshot' | 'addConfig'>;
  /** The app-wide server link; undefined when the build has none. */
  serverLink?: () => ServerLink | undefined;
  /** Setting groups for /api/state (supplied by the settings registry). */
  settingsProvider?: () => unknown[];
  /** Static files by path; defaults to the generated web UI. */
  assets?: Record<string, WebAsset>;
}

export type LanContext = Required<Omit<LanServerDeps, 'serverLink'>> & Pick<LanServerDeps, 'serverLink'>;
