/** Shared pieces of the VOD and live config loaders (BaseConfig.java, Decoder.java). */

import { fetchText, type RequestOptions } from '../http';
import { type ConfigEntry, isObject, type JsonObject, str } from '../types';
import { decodeConfigText } from './decode';

/** Top-level keys whose entries may be URLs of remote JSON arrays (BaseConfig.fetchArray). */
export const REMOTE_ARRAY_KEYS = ['headers', 'proxy', 'rules', 'doh'] as const;

/** Parses decoded config JSON; a `msg` field is the server's error message. */
export function toConfigObject(json: string): JsonObject {
  const value: unknown = JSON.parse(json);
  if (!isObject(value)) throw new Error('Config is not a JSON object');
  if ('msg' in value) throw new Error(str(value.msg));
  return value;
}

/** Decodes downloaded config text and parses it into a JSON object. */
export function readConfigObject(text: string, url: string): JsonObject {
  return toConfigObject(decodeConfigText(url, text));
}

/** Depot ("urls": [{url, name}]) entries, or [] when the object is a regular config. */
export function parseDepot(object: JsonObject): ConfigEntry[] {
  if (!Array.isArray(object.urls)) return [];
  return object.urls.filter(isObject).map((item) => ({ url: str(item.url), name: str(item.name), time: 0 }));
}

/** Json.safeListElement: an array of objects, or a single object as a one-item list. */
export function elementList(object: JsonObject, key: string): JsonObject[] {
  const value = object[key];
  if (isObject(value)) return [value];
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Object entries of a fetchArray field; unexpanded URL strings are skipped. */
export function objectArray(object: JsonObject, key: string): JsonObject[] {
  const value = object[key];
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function querySize(url: string): number {
  const index = url.indexOf('?');
  if (index < 0) return 0;
  return url
    .slice(index + 1)
    .replace(/#.*$/, '')
    .split('&')
    .filter((part) => part !== '').length;
}

/**
 * Decoder.getJson: download config text. Relative URLs resolve against the
 * redirected URL unless the redirect changed the query.
 */
export async function fetchConfigText(url: string, options?: RequestOptions): Promise<{ text: string; url: string }> {
  const result = await fetchText(url, options);
  return { text: result.text, url: querySize(result.url) === querySize(url) ? result.url : url };
}

/**
 * BaseConfig.fetchArray: a field may be a URL string, or an array mixing
 * objects with URL strings; each URL points at a remote JSON array that is
 * inlined. Failed fetches contribute nothing.
 */
export async function expandRemoteArrays(object: JsonObject, options?: RequestOptions): Promise<JsonObject> {
  const fetchArray = async (url: string): Promise<unknown[]> => {
    try {
      const value: unknown = JSON.parse((await fetchText(url, options)).text);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const result: JsonObject = { ...object };
  await Promise.all(
    REMOTE_ARRAY_KEYS.map(async (key) => {
      const value = object[key];
      if (value === undefined || isObject(value)) return;
      const items = typeof value === 'string' ? await fetchArray(value) : Array.isArray(value) ? value : [];
      const expanded = await Promise.all(
        items.map(async (item) => (typeof item === 'string' ? fetchArray(item) : isObject(item) ? [item] : [])),
      );
      result[key] = expanded.flat().filter(isObject);
    }),
  );
  return result;
}

/** Removes later duplicates by key, keeping the first (Java .distinct() on equals). */
export function distinctBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
