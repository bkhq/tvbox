import { useVodConfig } from '../../core/bootstrap';
import type { Site } from '../../core/types';

/** Site `siteKey` of the active config, or undefined. */
export function useSite(siteKey: string): Site | undefined {
  return useVodConfig().config?.sites.find((site) => site.key === siteKey);
}

/** Id of the active saved config: the `cid` of History and Keep records. */
export function useActiveCid(): number | undefined {
  return useVodConfig().entry?.id;
}
