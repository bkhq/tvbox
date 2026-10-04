/* eslint-disable no-undef, import/no-unresolved -- QuickJS fixture: prelude globals, bundled lib */
// Cat-style spider (__jsEvalReturn, async req = http, helpers from cat.js).
import { Crypto, load } from 'assets://js/lib/cat.js';

let siteKey = '';

async function init(cfg) {
    siteKey = cfg.skey + '/' + cfg.stype + '/' + cfg.ext;
    await new Promise((resolve) => setTimeout(resolve, 5));
}

async function home(filter) {
    const res = await req('https://fixtures.test/index.html', { method: 'get' });
    const $ = load(res.content);
    const classes = $('.nav li a').map((_, a) => ({ type_id: $(a).attr('href'), type_name: $(a).text() })).get();
    return JSON.stringify({ class: classes });
}

async function homeVod() {
    return JSON.stringify({ list: [] });
}

async function category(tid, pg, filter, extend) {
    return JSON.stringify({ page: pg, list: [{ vod_id: tid, vod_name: siteKey }] });
}

async function detail(id) {
    return JSON.stringify({ list: [{ vod_id: id, vod_name: Crypto.MD5(id).toString() }] });
}

async function search(wd, quick, pg) {
    local.set('cat', 'last', wd);
    return JSON.stringify({ list: [{ vod_id: local.get('cat', 'last'), vod_name: md5X(wd) }] });
}

async function play(flag, id, flags) {
    return JSON.stringify({ parse: 0, url: id, header: { Referer: 'https://fixtures.test/' } });
}

export function __jsEvalReturn() {
    return { init, home, homeVod, category, detail, search, play };
}
