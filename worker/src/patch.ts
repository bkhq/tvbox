// Local edits applied on top of the upstream config.

export interface Site {
  key: string;
  name: string;
  type: number;
  api: string;
  [field: string]: unknown;
}

export interface Config {
  sites: Site[];
  lives?: Record<string, unknown>[];
  doh?: { name: string; url: string; ips?: string[] }[];
  [field: string]: unknown;
}

// Upstream site keys to drop.
const REMOVE_SITES = new Set<string>([]);

// Sites appended after the upstream ones. "./" paths resolve to this worker.
const EXTRA_SITES: Site[] = [];

export function patch(config: Config): Config {
  config.sites = config.sites.filter((site) => !REMOVE_SITES.has(site.key)).concat(EXTRA_SITES);
  // Upstream has a typo in the Quad9 endpoint ("dns-quer").
  config.doh = config.doh?.map((doh) => ({ ...doh, url: doh.url.replace(/\/dns-quer$/, "/dns-query") }));
  // Upstream ships `"lives": [{}]`; drop empty entries.
  config.lives = config.lives?.filter((live) => Object.keys(live).length > 0);
  return config;
}
