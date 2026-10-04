/**
 * JS sources evaluated inside each QuickJS context before a spider loads.
 * They are plain strings (Hermes drops function source, so fn.toString()
 * cannot be used) and only rely on the host globals of the native contract:
 * __host_http, __host_local_get/set/delete and __host_log.
 *
 * - PRELUDE (script): http/req/_http (quickjs/.../lib/http.js + Global.req),
 *   local, console, setTimeout/clearTimeout/__drainTimers, joinUrl
 *   (UriUtil.resolve), md5X/aesX (Crypto.java, need CryptoJS), the
 *   global/window/self aliases.
 * - CRYPTO_MODULE: loads the bundled crypto-js.js (sets globalThis.CryptoJS).
 * - PARSER_MODULE: pd/pdfh/pdfa/pdfl, a port of spider/.../js/utils/Parser.java
 *   onto the bundled cheerio.
 * - spiderEntry(api): quickjs/.../lib/spider.js.
 *
 * The two modules are only evaluated when the spider source references their
 * globals (usesCrypto / usesParser).
 */

export const PRELUDE_FILENAME = 'tvbox://prelude.js';
export const CRYPTO_FILENAME = 'tvbox://crypto.js';
export const PARSER_FILENAME = 'tvbox://parser.js';
export const ENTRY_FILENAME = 'tvbox://spider.js';

export const PRELUDE = String.raw`
let req = (url, options) => http(url, Object.assign({
    async: false
}, options));

function http(url, options = {}) {
    if (options?.async === false) return _http(url, options)
    return new Promise(resolve => _http(url, Object.assign({
        complete: res => resolve(res)
    }, options))).catch(err => {
        console.error(err.name, err.message, err.stack)
        return {
            ok: false,
            status: 500,
            url
        }
    })
}

(function () {
    var g = globalThis;

    function str(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    // ---- console -> __host_log
    function format(args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) {
            var item = args[i];
            if (typeof item === 'string') parts.push(item);
            else if (item instanceof Error) parts.push(item.name + ': ' + item.message + (item.stack ? '\n' + item.stack : ''));
            else {
                try {
                    var json = JSON.stringify(item);
                    parts.push(json === undefined ? String(item) : json);
                } catch (e) {
                    parts.push(String(item));
                }
            }
        }
        return parts.join(' ');
    }
    var console = {};
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
        console[level] = function () {
            __host_log(level, format(arguments));
        };
    });
    g.console = console;

    // ---- base64 (QuickJS has no atob)
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function decodeBase64(text) {
        var clean = str(text).replace(/[^A-Za-z0-9+/]/g, '');
        var out = new Uint8Array(Math.floor(clean.length * 3 / 4));
        var buffer = 0, bits = 0, n = 0;
        for (var i = 0; i < clean.length; i++) {
            buffer = (buffer << 6) | B64.indexOf(clean.charAt(i));
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out[n++] = (buffer >> bits) & 0xff;
            }
        }
        return n === out.length ? out : out.subarray(0, n);
    }

    // ---- http: Global.req / Global._http over __host_http
    var ERROR = '{"code":"","headers":{},"content":""}';
    function request(url, options) {
        var opts = Object.assign({}, options);
        delete opts.complete;
        var buffer = opts.buffer === undefined || opts.buffer === null ? 0 : opts.buffer;
        // The host returns text for 0 and base64 for everything else.
        if (buffer !== 0) opts.buffer = 2;
        var res;
        try {
            res = JSON.parse(__host_http(str(url), JSON.stringify(opts)));
        } catch (e) {
            res = JSON.parse(ERROR);
        }
        if ((buffer === 1 || buffer === 3) && res.code !== '') {
            var bytes = decodeBase64(res.content);
            // buffer 1: JSUtil.toArray (signed Java bytes); buffer 3: raw bytes.
            res.content = buffer === 1 ? Array.prototype.map.call(bytes, function (b) { return (b << 24) >> 24; }) : bytes;
        }
        return res;
    }
    g._http = function (url, options) {
        var complete = options && typeof options.complete === 'function' ? options.complete : null;
        if (!complete) return request(url, options);
        Promise.resolve().then(function () {
            try {
                complete(request(url, options));
            } catch (e) {
                console.error('_http complete failed', e);
            }
        });
        return null;
    };

    // ---- local -> __host_local_*
    g.local = {
        get: function (rule, key) {
            return __host_local_get(str(rule), str(key));
        },
        set: function (rule, key, value) {
            __host_local_set(str(rule), str(key), str(value));
        },
        delete: function (rule, key) {
            __host_local_delete(str(rule), str(key));
        }
    };

    // ---- timers, run by the host through __drainTimers()
    var timers = {};
    var timerId = 0;
    g.setTimeout = function (fn, delay) {
        if (typeof fn !== 'function') return 0;
        var id = ++timerId;
        timers[id] = { fn: fn, due: Date.now() + Math.max(0, Number(delay) || 0) };
        return id;
    };
    g.clearTimeout = function (id) {
        delete timers[id];
    };
    /** Runs the timers due now; returns ms until the next timer, or -1 when none is left. */
    g.__drainTimers = function () {
        var now = Date.now();
        var due = Object.keys(timers).map(Number).filter(function (id) {
            return timers[id].due <= now;
        }).sort(function (a, b) {
            return timers[a].due - timers[b].due || a - b;
        });
        due.forEach(function (id) {
            var timer = timers[id];
            if (!timer) return;
            delete timers[id];
            try {
                timer.fn();
            } catch (e) {
                console.error('setTimeout callback failed', e);
            }
        });
        var next = -1;
        now = Date.now();
        for (var key in timers) {
            var wait = Math.max(0, timers[key].due - now);
            if (next < 0 || wait < next) next = wait;
        }
        return next;
    };

    // ---- joinUrl: UriUtil.resolve (RFC 3986)
    function indices(uri) {
        if (uri === '') return [-1, 0, 0, 0];
        var length = uri.length;
        var fragment = uri.indexOf('#');
        if (fragment === -1) fragment = length;
        var query = uri.indexOf('?');
        if (query === -1 || query > fragment) query = fragment;
        var schemeLimit = uri.indexOf('/');
        if (schemeLimit === -1 || schemeLimit > query) schemeLimit = query;
        var scheme = uri.indexOf(':');
        if (scheme > schemeLimit) scheme = -1;
        var authority = scheme + 2 < query && uri.charAt(scheme + 1) === '/' && uri.charAt(scheme + 2) === '/';
        var path;
        if (authority) {
            path = uri.indexOf('/', scheme + 3);
            if (path === -1 || path > query) path = query;
        } else {
            path = scheme + 1;
        }
        return [scheme, path, query, fragment];
    }
    function removeDotSegments(uri, offset, limit) {
        if (offset >= limit) return uri;
        if (uri.charAt(offset) === '/') offset++;
        var segmentStart = offset;
        var i = offset;
        while (i <= limit) {
            var nextSegmentStart;
            if (i === limit) nextSegmentStart = i;
            else if (uri.charAt(i) === '/') nextSegmentStart = i + 1;
            else {
                i++;
                continue;
            }
            if (i === segmentStart + 1 && uri.charAt(segmentStart) === '.') {
                uri = uri.slice(0, segmentStart) + uri.slice(nextSegmentStart);
                limit -= nextSegmentStart - segmentStart;
                i = segmentStart;
            } else if (i === segmentStart + 2 && uri.charAt(segmentStart) === '.' && uri.charAt(segmentStart + 1) === '.') {
                var prevSegmentStart = uri.lastIndexOf('/', segmentStart - 2) + 1;
                var removeFrom = Math.max(prevSegmentStart, offset);
                uri = uri.slice(0, removeFrom) + uri.slice(nextSegmentStart);
                limit -= nextSegmentStart - removeFrom;
                segmentStart = prevSegmentStart;
                i = prevSegmentStart;
            } else {
                i++;
                segmentStart = i;
            }
        }
        return uri;
    }
    function resolve(base, ref) {
        base = str(base);
        ref = str(ref);
        var r = indices(ref);
        if (r[0] !== -1) return removeDotSegments(ref, r[1], r[2]);
        var b = indices(base);
        if (r[3] === 0) return base.slice(0, b[3]) + ref;
        if (r[2] === 0) return base.slice(0, b[2]) + ref;
        var limit;
        if (r[1] !== 0) {
            limit = b[0] + 1;
            return removeDotSegments(base.slice(0, limit) + ref, limit + r[1], limit + r[2]);
        }
        if (ref.charAt(r[1]) === '/') {
            return removeDotSegments(base.slice(0, b[1]) + ref, b[1], b[1] + r[2]);
        }
        if (b[0] + 2 < b[1] && b[1] === b[2]) {
            return removeDotSegments(base.slice(0, b[1]) + '/' + ref, b[1], b[1] + r[2] + 1);
        }
        var lastSlash = base.lastIndexOf('/', b[2] - 1);
        limit = lastSlash === -1 ? b[1] : lastSlash + 1;
        return removeDotSegments(base.slice(0, limit) + ref, b[1], limit + r[2]);
    }
    g.joinUrl = function (parent, child) {
        return resolve(parent, child);
    };

    // ---- md5X / aesX: Crypto.java on CryptoJS (loaded by CRYPTO_MODULE)
    function cryptoJS() {
        if (!g.CryptoJS) throw new Error('CryptoJS is not loaded');
        return g.CryptoJS;
    }
    g.md5X = function (text) {
        try {
            return cryptoJS().MD5(str(text)).toString();
        } catch (e) {
            console.error('md5X failed', e);
            return '';
        }
    };
    var PADDING = { PKCS5: 'Pkcs7', PKCS7: 'Pkcs7', NO: 'NoPadding', ZERO: 'ZeroPadding', ZEROBYTE: 'ZeroPadding', ISO10126: 'Iso10126', ANSIX923: 'AnsiX923' };
    function padTo16(words) {
        // Arrays.copyOf(bytes, 16): zero-fill short keys / ivs.
        if (words.sigBytes >= 16) return words;
        words.clamp();
        while (words.words.length < 4) words.words.push(0);
        words.sigBytes = 16;
        return words;
    }
    g.aesX = function (mode, encrypt, input, inBase64, key, iv, outBase64) {
        try {
            var C = cryptoJS();
            var parts = str(mode).toUpperCase().split('/');
            var blockMode = C.mode[parts[1] || 'ECB'];
            var padding = C.pad[PADDING[parts[2] || 'PKCS5']];
            if (!blockMode || !padding) throw new Error('Unsupported mode ' + mode);
            var keyWords = padTo16(C.enc.Utf8.parse(str(key)));
            if ([16, 24, 32].indexOf(keyWords.sigBytes) < 0) throw new Error('Invalid key length');
            var cfg = { mode: blockMode, padding: padding };
            if (iv !== undefined && iv !== null) {
                cfg.iv = padTo16(C.enc.Utf8.parse(str(iv)));
                if (cfg.iv.sigBytes !== 16) throw new Error('Invalid iv length');
            }
            var data = inBase64 ? C.enc.Base64.parse(str(input).replace(/_/g, '/').replace(/-/g, '+').replace(/\s/g, '')) : C.enc.Utf8.parse(str(input));
            var out = encrypt ? C.AES.encrypt(data, keyWords, cfg).ciphertext : C.AES.decrypt(C.lib.CipherParams.create({ ciphertext: data }), keyWords, cfg);
            return outBase64 ? C.enc.Base64.stringify(out) : C.enc.Utf8.stringify(out);
        } catch (e) {
            console.error('aesX failed', e);
            return '';
        }
    };
})();

function defineGlobalAlias(name) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (descriptor && !descriptor.configurable) return;
    Object.defineProperty(globalThis, name, {
        enumerable: true,
        configurable: true,
        get() {
            return globalThis;
        },
        set() {}
    });
}

['global', 'window', 'self'].forEach(defineGlobalAlias);
`;

export const CRYPTO_MODULE = `import 'assets://js/lib/crypto-js.js';\n`;

export const PARSER_MODULE = String.raw`
import { load } from 'assets://js/lib/cheerio.min.js';

const URL_RE = /url\((.*?)\)/ms;
const NO_ADD = /:eq|:lt|:gt|:first|:last|:not|:even|:odd|:has|:contains|:matches|:empty|^body$|^#/;
const JOIN_URL = /(url|src|href|-original|-src|-play|-url|style)$|^(data-|url-|src-)/im;
const SPEC_URL = /^(ftp|magnet|thunder|ws):/im;

// String.split(regex) of Java: trailing empty strings are dropped.
function split(text, separator) {
    const parts = text.split(separator);
    while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts;
}

const cache = { pdfh: { html: null, $: null }, pdfa: { html: null, $: null } };
function doc(kind, html) {
    const entry = cache[kind];
    if (entry.html !== html) {
        entry.$ = load(html);
        entry.html = html;
    }
    return entry.$;
}

function parseInfo(rule) {
    const info = { rule, index: 0, excludes: null };
    if (rule.includes(':eq')) {
        info.rule = rule.split(':')[0];
        let pos = rule.split(':')[1] || '';
        if (info.rule.includes('--')) {
            const rules = split(info.rule, '--');
            info.excludes = rules.slice(1);
            info.rule = rules[0];
        } else if (pos.includes('--')) {
            const rules = split(pos, '--');
            info.excludes = rules.slice(1);
            pos = rules[0];
        }
        const index = pos.split('eq(').join('').split(')').join('');
        info.index = /^[+-]?\d+$/.test(index) ? parseInt(index, 10) : 0;
    } else if (rule.includes('--')) {
        const rules = split(rule, '--');
        info.excludes = rules.slice(1);
        info.rule = rules[0];
    }
    return info;
}

function hikerToJq(parse, first) {
    if (!parse.includes('&&')) {
        const parts = split(parse, ' ');
        if (!NO_ADD.test(parts[parts.length - 1]) && first) parse = parse + ':eq(0)';
        return parse;
    }
    const parses = split(parse, '&&');
    const items = [];
    for (let i = 0; i < parses.length; i++) {
        const parts = split(parses[i], ' ');
        if (NO_ADD.test(parts[parts.length - 1])) items.push(parses[i]);
        else if (!first && i >= parses.length - 1) items.push(parses[i]);
        else items.push(parses[i] + ':eq(0)');
    }
    return items.join(' ');
}

// jsoup select on Elements: matching elements and descendants, document order.
function parseOne($, parse, elements) {
    const info = parseInfo(parse);
    let found = elements === null ? $(info.rule) : elements.filter(info.rule).add(elements.find(info.rule));
    if (parse.includes(':eq')) {
        const index = info.index < 0 ? found.length + info.index : info.index;
        found = index >= 0 && index < found.length ? found.eq(index) : found.slice(0, 0);
    }
    if (info.excludes !== null && found.length > 0) {
        found = found.clone();
        for (const exclude of info.excludes) found.find(exclude).remove();
    }
    return found;
}

function select($, rule) {
    let elements = null;
    for (const parse of split(rule, ' ')) {
        elements = parseOne($, parse, elements);
        if (elements.length === 0) return null;
    }
    return elements;
}

function text(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function outerHtml($, elements) {
    return elements.toArray().map((el) => $.html(el));
}

function parseDomForUrl(html, rule, addUrl) {
    const $ = doc('pdfh', html);
    if (rule === 'body&&Text' || rule === 'Text') return text($.root().text());
    if (rule === 'body&&Html' || rule === 'Html') return $.html();
    let option = '';
    if (rule.includes('&&')) {
        const rs = split(rule, '&&');
        option = rs[rs.length - 1];
        rule = rs.slice(0, -1).join('&&');
    }
    const elements = select($, hikerToJq(rule, true));
    if (elements === null) return '';
    if (option === '') return outerHtml($, elements).join('\n');
    if (option === 'Text') return elements.toArray().map((el) => text($(el).text())).join(' ');
    if (option === 'Html') return elements.toArray().map((el) => $(el).html() || '').join('\n');
    let result = '';
    for (const name of option.split('|')) {
        result = '';
        for (const el of elements.toArray()) {
            const value = $(el).attr(name);
            if (value !== undefined) {
                result = value;
                break;
            }
        }
        if (name.toLowerCase().includes('style') && result.includes('url(')) {
            const m = URL_RE.exec(result);
            if (m) result = m[1];
            result = result.replace(/^['|"](.*)['|"]$/, '$1');
        }
        if (result !== '' && addUrl !== '' && JOIN_URL.test(name) && !SPEC_URL.test(result)) {
            result = result.includes('http') ? result.substring(result.indexOf('http')) : joinUrl(addUrl, result);
        }
        if (result !== '') return result;
    }
    return result;
}

function parseDomForArray(html, rule) {
    const $ = doc('pdfa', html);
    const elements = select($, hikerToJq(rule, false));
    return elements === null ? [] : outerHtml($, elements);
}

function parseDomForList(html, rule, texts, urls, urlKey) {
    const $ = doc('pdfa', html);
    const elements = select($, hikerToJq(rule, false));
    if (elements === null) return [];
    return outerHtml($, elements).map((item) => parseDomForUrl(item, texts, '').trim() + '$' + parseDomForUrl(item, urls, urlKey));
}

function str(value) {
    return value === undefined || value === null ? '' : String(value);
}

// Function.java returns null when the parser throws.
function guard(fn) {
    return function () {
        try {
            return fn.apply(null, Array.prototype.map.call(arguments, str));
        } catch (e) {
            console.error('pd failed', e);
            return null;
        }
    };
}

globalThis.pd = guard((html, rule, urlKey) => parseDomForUrl(html, rule, urlKey));
globalThis.pdfh = guard((html, rule) => parseDomForUrl(html, rule, ''));
globalThis.pdfa = guard((html, rule) => parseDomForArray(html, rule));
globalThis.pdfl = guard((html, rule, texts, urls, urlKey) => parseDomForList(html, rule, texts, urls, urlKey));
`;

/** quickjs/.../lib/spider.js with the spider module name filled in. */
export function spiderEntry(api: string): string {
  return `import * as spider from ${JSON.stringify(api)}

if (!globalThis.__JS_SPIDER__) {
    if (spider.__jsEvalReturn) {
        globalThis.req = http
        globalThis.__JS_SPIDER__ = spider.__jsEvalReturn()
    } else if (spider.default) {
        globalThis.__JS_SPIDER__ = typeof spider.default === 'function' ? spider.default() : spider.default
    }
}
`;
}

export function usesCrypto(source: string): boolean {
  return /\b(?:md5X|aesX)\b/.test(source);
}

export function usesParser(source: string): boolean {
  return /\bpd(?:fh|fa|fl)?\s*\(/.test(source);
}
