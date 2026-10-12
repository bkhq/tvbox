/** JS spider sources in the FongMi QuickJS format, served to JsSpiderProvider by a mocked fetch. */

/** Full spider: default export object, uses req, http, local and joinUrl. */
export const FIXTURE_SPIDER = `
const HOST = 'https://fixture.example.com';
let ext = null;

export default {
    async init(cfg) {
        ext = cfg;
        local.set('fixture', 'ext', typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    },
    async home(filter) {
        const res = req(joinUrl(HOST + '/api/v1/', '../home.json'), { headers: { 'X-Filter': String(filter) } });
        return res.content;
    },
    async homeVod() {
        return { list: [{ vod_id: 'hv1', vod_name: 'Home video', vod_pic: joinUrl(HOST + '/a/b', 'img.jpg') }] };
    },
    async category(tid, pg, filter, extend) {
        return JSON.stringify({
            page: Number(pg),
            pagecount: 9,
            list: [{ vod_id: tid + '-' + pg, vod_name: String(filter), vod_remarks: JSON.stringify(extend) }],
        });
    },
    async detail(id) {
        const res = await http(HOST + '/detail?id=' + id);
        const vod = JSON.parse(res.content);
        return { list: [Object.assign(vod, { vod_remarks: local.get('fixture', 'ext') })] };
    },
    async search(key, quick, pg) {
        return { list: [{ vod_id: key, vod_name: String(quick) + ':' + (pg === undefined ? 'none' : pg) }] };
    },
    async play(flag, id, flags) {
        return JSON.stringify({ parse: 0, url: id + '#' + flags.join(','), header: flag === 'own' ? { Referer: HOST } : {} });
    },
    async destroy() {
        local.set('fixture', 'destroyed', String(ext !== null));
    },
};
`;

/** Cat-style spider (__jsEvalReturn): init receives { stype, skey, ext }. */
export const CAT_SPIDER = `
let cfg = null;

function init(value) {
    cfg = value;
}

function home() {
    return JSON.stringify({ class: [{ type_id: '1', type_name: cfg.skey + ':' + cfg.stype + ':' + JSON.stringify(cfg.ext) }] });
}

export function __jsEvalReturn() {
    return { init, home };
}
`;

/** Old style: assigns __JS_SPIDER__ directly (rewritten to globalThis.__JS_SPIDER__). */
export const GLOBAL_SPIDER = `
__JS_SPIDER__ = {
    init() {},
    home() {
        return { class: [{ type_id: 'g', type_name: 'global' }] };
    },
};
`;

/** Factory default export with per-context global state. */
export const COUNTER_SPIDER = `
export default function () {
    return {
        init() {
            globalThis.counter = (globalThis.counter || 0) + 1;
        },
        home() {
            return { list: [{ vod_id: String(globalThis.counter), vod_name: typeof globalThis.leak }] };
        },
        homeVod() {
            globalThis.leak = 'set';
            return {};
        },
    };
}
`;

/** Misbehaving spider: an exception, garbage results and a promise that never settles. */
export const BAD_SPIDER = `
export default {
    init() {},
    home() {
        throw new Error('home exploded');
    },
    homeVod() {
        return 'not json at all';
    },
    category() {
        return 42;
    },
    async detail() {
        return null;
    },
    search() {
        return '[1, 2, 3]';
    },
    play() {
        return new Promise(() => {});
    },
};
`;

/** Slow spider: a far timer and a busy loop both hit the per-call timeout; the context stays usable. */
export const SLOW_SPIDER = `
export default {
    init() {},
    async home() {
        await new Promise((resolve) => setTimeout(resolve, 60000));
        return {};
    },
    homeVod() {
        for (;;) {}
    },
    async category(tid) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { list: [{ vod_id: tid, vod_name: 'after timeout' }] };
    },
};
`;

/** init throws until local "flaky/ok" is set: the first init fails, the retry succeeds. */
export const FLAKY_SPIDER = `
export default {
    init() {
        if (local.get('flaky', 'ok') === '') {
            local.set('flaky', 'ok', '1');
            throw new Error('init failed once');
        }
    },
    home() {
        return { class: [{ type_id: 'ok', type_name: 'recovered' }] };
    },
};
`;

/** Uses md5X and pdfh / pdfa, so the provider loads crypto-js and the parser module. */
export const HELPER_SPIDER = `
const HTML = '<ul><li><a href="/v/1" title="One">One</a></li><li><a href="/v/2" title="Two">Two</a></li></ul>';

export default {
    init() {},
    home() {
        const items = pdfa(HTML, 'ul&&li');
        return {
            list: items.map((item) => ({
                vod_id: pd(item, 'a&&href', 'https://h.example.com/x/'),
                vod_name: pdfh(item, 'a&&Text'),
                vod_remarks: md5X(pdfh(item, 'a&&title')),
            })),
        };
    },
};
`;
