/**
 * Plain-text decoding applied to downloaded config text, mirroring
 * api/Decoder.java: embedded base64 payload extraction and relative URL
 * rewriting. The AES-CBC ("2423...") variant is not a pure text transform and
 * is rejected.
 */

/** Resolves "./" or "../" against `base` the way UriUtil.resolve does. */
export function resolveRelative(base: string, reference: './' | '../'): string {
  const clean = base.replace(/[?#].*$/, '');
  const schemeEnd = clean.indexOf('://');
  let prefix = '';
  let path = clean;
  if (schemeEnd >= 0) {
    const pathStart = clean.indexOf('/', schemeEnd + 3);
    prefix = pathStart >= 0 ? clean.slice(0, pathStart) : clean;
    path = pathStart >= 0 ? clean.slice(pathStart) : '/';
  }
  let dir = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  if (reference === '../' && dir.length > 1) {
    dir = dir.slice(0, dir.slice(0, -1).lastIndexOf('/') + 1) || '/';
  }
  return prefix + dir;
}

/** Decoder.JS_URI; like the Java pattern it can span several strings on one line. */
const JS_URI = /"(\.|\.\.)\/(.?|.+?)\.js\?(.?|.+?)"/g;

/**
 * Decoder.fix: rewrite every "./" and "../" in the text against the config
 * URL. Query strings of relative ".js?" references are protected so only
 * their leading path is rewritten.
 */
export function fixRelativeUrls(url: string, data: string): string {
  const dot = resolveRelative(url, './');
  const dotDot = resolveRelative(url, '../');
  for (const match of data.match(JS_URI) ?? []) {
    let fixed = match.replace('"./', `"${dot}`).replace('"../', `"${dotDot}`);
    fixed = fixed.replaceAll('./', '__JS1__').replaceAll('../', '__JS2__');
    data = data.replaceAll(match, fixed);
  }
  data = data.replaceAll('../', dotDot);
  data = data.replaceAll('./', dot);
  data = data.replaceAll('__JS1__', './');
  data = data.replaceAll('__JS2__', '../');
  return data;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes standard base64 (whitespace and padding tolerated) as UTF-8. */
export function decodeBase64(input: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = BASE64_CHARS.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!;
    let code: number;
    let extra: number;
    if (b < 0x80) {
      code = b;
      extra = 0;
    } else if (b >= 0xf0) {
      code = b & 0x07;
      extra = 3;
    } else if (b >= 0xe0) {
      code = b & 0x0f;
      extra = 2;
    } else if (b >= 0xc0) {
      code = b & 0x1f;
      extra = 1;
    } else {
      out += '�';
      continue;
    }
    let valid = true;
    for (let j = 0; j < extra; j++) {
      const next = bytes[i];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
      i++;
    }
    out += valid && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
  }
  return out;
}

/** Decoder.extract + base64: payload follows the first "xxxxxxxx**" marker. */
function extractBase64(data: string): string {
  const match = /[A-Za-z0-9]{8}\*\*/.exec(data);
  if (!match) return data;
  return decodeBase64(data.slice(match.index + 10));
}

export function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Decoder.verify: turn downloaded config text into JSON text. */
export function decodeConfigText(url: string, data: string): string {
  if (data === '') throw new Error('Empty config');
  if (isJsonObject(data)) return fixRelativeUrls(url, data);
  if (data.includes('**')) data = extractBase64(data);
  if (data.startsWith('2423')) throw new Error('Encrypted config is not supported');
  return fixRelativeUrls(url, data);
}
