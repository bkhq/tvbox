/**
 * Pure helpers for reading an upstream TVBox config and pointing its files
 * at our own mirror. No I/O here — `sync.service.ts` drives them.
 */

/** Top-level arrays whose entries are stored and edited one row at a time. */
export const LIST_KINDS = [
  "sites",
  "parses",
  "lives",
  "rules",
  "doh",
] as const;
export type ListKind = typeof LIST_KINDS[number];

export type JsonObject = Record<string, unknown>;

// TVBox's own marker for a base64 payload appended to an image or page.
const RE_PAYLOAD_MARKER = /[A-Z0-9]{8}\*\*/i;
const RE_NON_BASE64 = /[^A-Z0-9+/=]/gi;
const RE_LINE_COMMENT = /^\s*\/\/.*$/gm;
const RE_MD5_SUFFIX = /;md5;/i;
const RE_UNSAFE_NAME = /[^\w.-]/g;

function parseObject(text: string): JsonObject | undefined {
  for (const candidate of [
    text,
    text.replace(RE_LINE_COMMENT, ""),
  ]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        return value as JsonObject;
      return undefined;
    }
    catch {
      // try the next form
    }
  }
  return undefined;
}

/** Decode the formats TVBox clients accept: plain JSON, or a base64 payload after `xxxxxxxx**`. */
export function decodeUpstream(raw: string): JsonObject {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const direct = parseObject(text);
  if (direct)
    return direct;

  const marker = RE_PAYLOAD_MARKER.exec(text);
  if (marker) {
    const encoded = text.slice(marker.index + marker[0].length).replace(RE_NON_BASE64, "");
    const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
    const decoded = parseObject(new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trim());
    if (decoded)
      return decoded;
  }
  throw new Error("Upstream is not a TVBox config (expected JSON or a base64 payload)");
}

/**
 * The lines of a collection, a config that lists other configs (`urls`, which
 * the app offers as switchable lines), resolved against its URL; undefined
 * for an ordinary config. Lines the Worker cannot fetch (not http) are left out.
 */
export function collectionLines(config: JsonObject, base: string): { name: string; url: string }[] | undefined {
  if (!Array.isArray(config.urls) || "sites" in config)
    return undefined;
  const lines: { name: string; url: string }[] = [];
  for (const item of config.urls as unknown[]) {
    const { url, name } = (item ?? {}) as { url?: unknown; name?: unknown };
    if (typeof url !== "string" || url.trim() === "")
      continue;
    let href: string;
    try {
      href = new URL(url.trim(), base).href;
    }
    catch {
      continue;
    }
    if (!isHttpUrl(href) || lines.some(l => l.url === href))
      continue;
    lines.push({
      name: typeof name === "string" && name.trim() !== ""
        ? name.trim()
        : href,
      url: href,
    });
  }
  return lines;
}

/** Resolve every `./` or `../` string in the tree against the upstream URL, as TVBox clients do. */
export function resolveRelative(value: unknown, base: string): unknown {
  if (typeof value === "string") {
    return value.startsWith("./") || value.startsWith("../")
      ? new URL(value, base).href
      : value;
  }
  if (Array.isArray(value))
    return value.map(v => resolveRelative(v, base));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
      k,
      resolveRelative(v, base),
    ]));
  }
  return value;
}

/** `url;md5;<hash>` → its parts. Used by `spider` and site `jar`. */
export function splitJarSpec(spec: string): { url: string; md5?: string } {
  const match = RE_MD5_SUFFIX.exec(spec);
  if (!match)
    return { url: spec };
  return {
    url: spec.slice(0, match.index),
    md5: spec.slice(match.index + match[0].length),
  };
}

/** Stable identity of a list entry within one upstream. */
export function entryIdentity(kind: ListKind, entry: JsonObject): string {
  const field = kind === "sites"
    ? entry.key
    : entry.name;
  return typeof field === "string" && field !== ""
    ? field
    : JSON.stringify(entry);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

function walkStrings(value: unknown, visit: (s: string, key: string | undefined) => void, key?: string): void {
  if (typeof value === "string")
    visit(value, key);
  else if (Array.isArray(value))
    value.forEach(v => walkStrings(v, visit, key));
  else if (value !== null && typeof value === "object")
    Object.entries(value).forEach(([k, v]) => walkStrings(v, visit, k));
}

/**
 * URLs worth mirroring in an already-resolved config: the spider and every
 * site `jar` wherever they are hosted (losing one breaks every site that
 * depends on it), plus any other file under the upstream's own directory.
 * Third-party hosts are left alone.
 */
export function collectAssetUrls(config: JsonObject, base: string): Set<string> {
  const dir = new URL("./", base).href;
  const urls = new Set<string>();
  walkStrings(config, (value, key) => {
    if (key === "spider" || key === "jar") {
      const { url } = splitJarSpec(value);
      if (isHttpUrl(url))
        urls.add(url);
    }
    else if (value.startsWith(dir) && value.length > dir.length) {
      urls.add(value);
    }
  });
  return urls;
}

export interface MirroredAsset {
  readonly sha256: string;
  readonly md5: string;
  readonly name: string;
}

/** Path a mirrored file is served under, relative to the published config. */
export function assetPath(asset: MirroredAsset): string {
  return `./a/${asset.sha256}/${asset.name}`;
}

/** File name for a mirrored URL: the last path segment, made path-safe. */
export function assetName(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(last).replace(RE_UNSAFE_NAME, "_") || "file";
}

/** Replace mirrored URLs with their local path; jar specs get the mirror's md5. */
export function rewriteAssets(value: unknown, mirrored: ReadonlyMap<string, MirroredAsset>, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "spider" || key === "jar") {
      const asset = mirrored.get(splitJarSpec(value).url);
      return asset
        ? `${assetPath(asset)};md5;${asset.md5}`
        : value;
    }
    const asset = mirrored.get(value);
    return asset
      ? assetPath(asset)
      : value;
  }
  if (Array.isArray(value))
    return value.map(v => rewriteAssets(v, mirrored, key));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
      k,
      rewriteAssets(v, mirrored, k),
    ]));
  }
  return value;
}
