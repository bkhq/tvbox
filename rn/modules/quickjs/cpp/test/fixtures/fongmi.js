/* eslint-disable no-undef -- QuickJS fixture: globals come from the spider prelude */
// FongMi-style spider (default export, sync req from the prelude).
const HOST = 'https://fixtures.test';
let ext = '';

function page(path) {
    return req(joinUrl(HOST + '/vod/', path), { headers: { 'User-Agent': 'smoke' } }).content;
}

export default {
    init(cfg) {
        ext = cfg;
        local.set('smoke', 'ext', cfg);
    },
    home(filter) {
        const html = page('../index.html');
        const classes = pdfa(html, '.nav&&li').map((li) => ({ type_id: pdfh(li, 'a&&href'), type_name: pdfh(li, 'a&&Text') }));
        return JSON.stringify({ class: classes, filters: filter ? {} : undefined });
    },
    homeVod() {
        const html = page('../index.html');
        return JSON.stringify({ list: pdfl(html, '.vods&&li', 'a&&Text', 'a&&href', HOST).map((item) => ({ vod_id: item.split('$')[1], vod_name: item.split('$')[0] })) });
    },
    category(tid, pg, filter, extend) {
        const html = page('../index.html');
        const list = pdfa(html, '.vods&&li').map((li) => ({ vod_id: pd(li, 'a&&href', HOST), vod_name: pdfh(li, 'a&&Text'), vod_pic: pd(li, 'img&&data-src', HOST) }));
        return JSON.stringify({ page: Number(pg), list, tid, extend });
    },
    detail(id) {
        return { list: [{ vod_id: id, vod_name: md5X(id), vod_content: local.get('smoke', 'ext'), vod_play_from: 'smoke', vod_play_url: 'ep1$' + aesX('AES/CBC/PKCS7', true, 'hello tvbox', false, '1234567890abcdef', 'abcdef1234567890', true) }] };
    },
    search(key, quick) {
        return JSON.stringify({ list: [{ vod_id: key, vod_name: key + (quick ? ':quick' : '') }] });
    },
    play(flag, id, flags) {
        const url = aesX('AES/CBC/PKCS7', false, id, true, '1234567890abcdef', 'abcdef1234567890', false);
        return JSON.stringify({ parse: 0, url, flag, ext });
    },
};
