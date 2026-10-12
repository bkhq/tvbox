/* eslint-disable no-undef -- QuickJS fixture: globals come from the spider prelude */
// Script run after the prelude, crypto and parser modules: asserts the
// host-facing helpers directly. Throws on the first mismatch.
(function () {
    function eq(name, actual, expected) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) throw new Error(name + ': got ' + a + ', want ' + e);
    }
    eq('md5X', md5X('tvbox'), '5060550e1d841c91a8cc7aa0ce63fd03');
    eq('aesX cbc encrypt', aesX('AES/CBC/PKCS7', true, 'hello tvbox', false, '1234567890abcdef', 'abcdef1234567890', true), 'Ph+G47z0ScV31qvBk2D0Yg==');
    eq('aesX cbc decrypt', aesX('AES/CBC/PKCS5', false, 'Ph+G47z0ScV31qvBk2D0Yg==', true, '1234567890abcdef', 'abcdef1234567890', false), 'hello tvbox');
    eq('aesX ecb short key', aesX('AES/ECB/PKCS5', true, 'ecb', false, 'short', null, true), 'cvs9dMTo1qBBIJKLPUd9JQ==');
    eq('joinUrl relative', joinUrl('https://a.com/x/y.html', '../z.js?q=1'), 'https://a.com/z.js?q=1');
    eq('joinUrl absolute path', joinUrl('https://a.com/x/y.html', '/p'), 'https://a.com/p');
    eq('joinUrl scheme', joinUrl('https://a.com/x/', 'http://b.com/c'), 'http://b.com/c');
    const html = "<div class='nav'><ul><li><a href='/t/1'>电影</a></li><li><a href='/t/2'> TV  Show </a></li></ul></div>";
    eq('pdfh text', pdfh(html, '.nav&&li:eq(1)&&Text'), 'TV Show');
    eq('pdfh attr', pdfh(html, '.nav&&a&&href'), '/t/1');
    eq('pd join', pd(html, '.nav&&a&&href', 'https://a.com/x/'), 'https://a.com/t/1');
    eq('pdfa', pdfa(html, '.nav&&li').length, 2);
    eq('pdfl', pdfl(html, '.nav&&li', 'a&&Text', 'a&&href', 'https://a.com'), ['电影$https://a.com/t/1', 'TV Show$https://a.com/t/2']);
    local.set('rule', 'key', 'v1');
    eq('local get', local.get('rule', 'key'), 'v1');
    local.delete('rule', 'key');
    eq('local deleted', local.get('rule', 'key'), '');
    const res = req('https://fixtures.test/echo', { method: 'post', headers: { A: 'b' }, data: { x: 1 }, postType: 'json' });
    eq('req code', res.code, 200);
    eq('req options', JSON.parse(res.content), { async: false, method: 'post', headers: { A: 'b' }, data: { x: 1 }, postType: 'json' });
    eq('req bytes', req('https://fixtures.test/bytes', { buffer: 1 }).content, [104, 105, -1]);
    eq('req failure', req('https://nowhere.test/'), { code: '', headers: {}, content: '' });
    eq('aliases', [global === globalThis, window === globalThis, self === globalThis], [true, true, true]);
})();
