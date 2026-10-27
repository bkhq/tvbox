'use strict';

// ── helpers ──

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IC_DIR = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23F5A623'><path d='M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z'/></svg>`;
const IC_FILE = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23717970'><path d='M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z'/></svg>`;
const POSTER_FALLBACK = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'><rect width='2' height='3' fill='%2399a'/></svg>`;
const TABS = ['remote', 'search', 'library', 'more'];
const LINK_RE = /^https?:\/\//i;

let currentTab = 'remote';
let paired = false;
let snackbarTimer = null;
let seeking = false;
let playerTimer = null;
let lastPlayer = null;

function token() {
    return localStorage.getItem('token') || '';
}

/** Keeps this phone's token for the TV; under nip.io also in the cookie every address of the TV shares. */
function saveToken(value) {
    localStorage.setItem('token', value);
    const cookie = tokenCookie();
    if (cookie && value.length <= cookie.pad.length * 2) {
        document.cookie = `${cookie.name}=${xorHex(value, cookie.pad)}; Domain=nip.io; Path=/; Max-Age=315360000; SameSite=Lax`;
    }
}

/** The token in the shared cookie; '' outside nip.io or without one. */
function savedToken() {
    const cookie = tokenCookie();
    if (!cookie) return '';
    const pair = document.cookie.split('; ').find((item) => item.startsWith(cookie.name + '='));
    const value = pair ? pair.slice(cookie.name.length + 1) : '';
    return /^(?:[0-9a-f]{2})+$/.test(value) && value.length <= cookie.pad.length * 2 ? xorHex(value, cookie.pad) : '';
}

/**
 * The shared cookie of this TV under nip.io, where any nip.io site can read it: its name is a hash of the TV's id and
 * its value the token XOR a key derived from that id, so neither shows without the TV's QR code. null without either.
 */
function tokenCookie() {
    const device = localStorage.getItem('device');
    if (!device || !/\.nip\.io$/i.test(location.hostname)) return null;
    return { name: 't' + toHex(sha256('name:' + device)).slice(0, 16), pad: sha256('value:' + device) };
}

const toHex = (bytes) => bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');

function xorHex(hex, pad) {
    return toHex(hex.match(/../g).map((pair, i) => parseInt(pair, 16) ^ pad[i]));
}

const SHA_K = [];
const SHA_H = [];
(() => {
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2, found = 0; found < 64; n++) {
        let prime = true;
        for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
        if (!prime) continue;
        if (found < 8) SHA_H[found] = frac(Math.sqrt(n));
        SHA_K[found++] = frac(Math.cbrt(n));
    }
})();

/** SHA-256 of a string's UTF-8 bytes, as bytes; the page is plain http, where crypto.subtle is missing. */
function sha256(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const bits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
    const hash = SHA_H.slice();
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        [a, b, c, d, e, f, g, h].forEach((v, i) => { hash[i] = (hash[i] + v) | 0; });
    }
    return hash.flatMap((v) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function headers() {
    return token() ? { 'X-Token': token() } : {};
}

function onUnauthorized() {
    // The saved token is gone on the TV: take the QR code's fresh key instead, unless that is the token just refused.
    const refused = token();
    localStorage.removeItem('token');
    paired = false;
    const key = sessionStorage.getItem('key');
    sessionStorage.removeItem('key');
    if (key && key !== refused) {
        saveToken(key);
        location.reload();
        return;
    }
    showPairDialog();
}

/** POST /api/<path>; resolves the response text, rejects with { status, message } on error. */
function api(path, params) {
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => body.append(k, v === undefined || v === null ? '' : String(v)));
    return fetch('/api/' + path, { method: 'POST', headers: headers(), body }).then(
        async (res) => {
            const text = await res.text();
            if (res.status === 401) { onUnauthorized(); throw { status: 401, message: '未配对' }; }
            if (!res.ok) throw { status: res.status, message: text || '操作失败' };
            return text;
        },
        () => { throw { status: 0, message: '连接电视失败' }; },
    );
}

function getJson(path, params) {
    const query = new URLSearchParams(params || {}).toString();
    return fetch(path + (query ? '?' + query : ''), { headers: headers() }).then(
        async (res) => {
            if (res.status === 401) { onUnauthorized(); throw { status: 401, message: '未配对' }; }
            const text = await res.text();
            if (!res.ok) throw { status: res.status, message: text || '加载失败' };
            return JSON.parse(text);
        },
        (e) => { throw e && e.status !== undefined ? e : { status: 0, message: '连接电视失败' }; },
    );
}

function act(path, params, done) {
    return api(path, params).then(done, (e) => { if (e.status !== 401) toast(e.message); });
}

function toast(msg) {
    const bar = $('snackbar');
    bar.textContent = msg;
    bar.classList.add('show');
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => bar.classList.remove('show'), 1600);
}

function loading(on) {
    $('loading').classList.toggle('show', !!on);
}

function vibrate() {
    if (navigator.vibrate) navigator.vibrate(10);
}

function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function poster(url) {
    return `<img class="poster" src="${esc(url || POSTER_FALLBACK)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${POSTER_FALLBACK}'">`;
}

function meta(parts) {
    return parts.filter(Boolean).join(' · ');
}

// ── overlays and history ──

const overlays = [];
let popping = false;

function openOverlay(id) {
    $(id).classList.add('open');
    overlays.push(id);
    history.pushState({ overlay: id }, '');
}

function closeOverlay(id) {
    const index = overlays.lastIndexOf(id);
    if (index < 0) return;
    overlays.splice(index, 1);
    $(id).classList.remove('open');
    if (!popping) { popping = true; history.back(); }
}

window.addEventListener('popstate', () => {
    if (popping) { popping = false; return; }
    const id = overlays.pop();
    if (id) { $(id).classList.remove('open'); if (id === 'confirm_dialog') settleConfirm(false); return; }
    if (currentTab === 'files') {
        if (files.parent === '.') showTab('more', true);
        else { listFiles(files.parent); history.pushState({ tab: 'files' }, ''); }
    }
});

let confirmResolve = null;

function settleConfirm(value) {
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(value);
}

/** Asks for confirmation; resolves true when confirmed. */
function confirmDialog(title, body, { danger = false, ok = '确定' } = {}) {
    $('confirm_title').textContent = title;
    $('confirm_body').textContent = body;
    const okBtn = $('confirm_ok');
    okBtn.textContent = ok;
    okBtn.classList.toggle('error', danger);
    openOverlay('confirm_dialog');
    return new Promise((resolve) => { confirmResolve = resolve; });
}

// ── pairing ──

function guessName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android 手机';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows 电脑';
    return '浏览器';
}

function showPairDialog() {
    const dialog = $('pair_dialog');
    if (dialog.classList.contains('open')) return;
    $('pair_code').value = '';
    if (!$('pair_name').value) $('pair_name').value = guessName();
    dialog.classList.add('open');
    setTimeout(() => $('pair_code').focus(), 50);
}

function confirmPair() {
    const code = $('pair_code').value.trim();
    const name = $('pair_name').value.trim();
    if (code.length !== 6) { toast('请输入 6 位配对码'); return; }
    const body = new URLSearchParams({ code, name });
    fetch('/api/pair', { method: 'POST', body }).then(async (res) => {
        if (res.status === 403) { toast('配对码错误'); return; }
        if (!res.ok) { toast((await res.text()) || '配对失败'); return; }
        const data = await res.json();
        saveToken(data.token);
        paired = true;
        $('pair_dialog').classList.remove('open');
        toast('配对成功');
        onPaired();
    }, () => toast('连接电视失败'));
}

function onPaired() {
    loadState();
    pollPlayer();
    if (currentTab === 'library') loadLibrary();
    if (currentTab === 'search') loadWords();
}

// ── tabs ──

function showTab(name, replace) {
    if (!TABS.includes(name) && name !== 'files') name = 'remote';
    const previous = currentTab;
    currentTab = name;
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.tab === (name === 'files' ? 'more' : name)));
    $('app_body').scrollTop = 0;
    renderMini(lastPlayer);
    if (name === 'files' && previous !== 'files') { if (!replace) history.pushState({ tab: 'files' }, ''); listFiles(''); }
    if (name === 'library' && paired) loadLibrary();
    if (name === 'search' && paired && !search.current) loadWords();
}

// ── player ──

function renderPlayer(player) {
    lastPlayer = player;
    const card = $('now_card');
    const active = !!(player && player.active);
    card.dataset.active = active ? '1' : '0';
    if (!active) {
        $('np_title').textContent = '未在播放';
        $('np_seek').disabled = true;
        renderMini(player);
        return;
    }
    $('np_title').textContent = player.title || '正在播放';
    $('np_position').textContent = formatTime(player.position);
    $('np_duration').textContent = formatTime(player.duration);
    const seek = $('np_seek');
    if (!seeking) {
        seek.disabled = !(player.duration > 0);
        seek.max = player.duration || 0;
        seek.value = player.position || 0;
    }
    card.classList.toggle('playing', !!player.playing);
    const speed = String(Number(player.speed));
    if ($('np_speed').querySelector(`option[value="${speed}"]`)) $('np_speed').value = speed;
    renderMini(player);
}

function renderMini(player) {
    const mini = $('mini_player');
    const show = currentTab !== 'remote' && !!(player && player.active);
    mini.classList.toggle('hidden', !show);
    if (!show) return;
    $('mini_title').textContent = player.title || '正在播放';
    mini.classList.toggle('playing', !!player.playing);
    $('mini_progress').style.width = player.duration > 0 ? `${(player.position / player.duration) * 100}%` : '0';
}

function pollPlayer() {
    if (!paired) return;
    getJson('/api/state', { only: 'player' }).then((state) => renderPlayer(state.player), () => undefined);
}

function control(action, value) {
    act('control', { do: action, value: value === undefined ? '' : value }, () => setTimeout(pollPlayer, 300));
}

// ── remote ──

function sendKey(key) {
    vibrate();
    act('remote', { do: 'key', value: key });
}

function sendVolume(direction) {
    act('remote', { do: 'volume', value: direction });
}

function sendText() {
    const input = $('remote_text');
    const text = input.value;
    if (!text) return;
    act('remote', { do: 'text', value: text }, () => { input.value = ''; toast('已发送'); });
}

// ── search ──

const search = { seq: 0, current: null, timer: null, filter: '', snapshot: null };

function loadWords() {
    getJson('/api/search').then(renderWords, () => undefined);
}

function renderWords(words) {
    const render = (id, block, items, action) => {
        $(block).classList.toggle('hidden', !items.length);
        $(id).innerHTML = items.map((w) => `<button class="chip" data-action="${action}" data-word="${esc(w)}">${esc(w)}</button>`).join('');
    };
    render('words_history', 'words_history_block', words.history || [], 'word');
    render('words_hot', 'words_hot_block', words.hot || [], 'word');
}

function onSearchInput() {
    const text = $('search_input').value.trim();
    $('search_clear').classList.toggle('hidden', !text);
    const link = LINK_RE.test(text);
    $('search_link').classList.toggle('hidden', !link);
    if (!text) { clearSearch(); return; }
    if (link) { $('search_words').classList.add('hidden'); $('search_results').classList.add('hidden'); }
}

function clearSearch() {
    stopSearchPolling();
    search.seq++;
    search.current = null;
    search.snapshot = null;
    $('search_input').value = '';
    $('search_clear').classList.add('hidden');
    $('search_link').classList.add('hidden');
    $('search_results').classList.add('hidden');
    $('search_words').classList.remove('hidden');
    if (paired) loadWords();
}

function stopSearchPolling() {
    if (search.timer) { clearTimeout(search.timer); search.timer = null; }
}

function submitSearch(word) {
    const keyword = (word !== undefined ? word : $('search_input').value).trim();
    if (!keyword) return;
    $('search_input').value = keyword;
    $('search_input').blur();
    $('search_clear').classList.remove('hidden');
    if (LINK_RE.test(keyword)) { onSearchInput(); return; }
    stopSearchPolling();
    const seq = ++search.seq;
    search.current = null;
    search.filter = '';
    search.snapshot = null;
    $('search_words').classList.add('hidden');
    $('search_link').classList.add('hidden');
    $('search_results').classList.remove('hidden');
    $('results_status').textContent = '搜索中…';
    $('results_filters').innerHTML = '';
    $('results_list').innerHTML = '';
    getJson('/api/search', { word: keyword }).then((snapshot) => onSearchSnapshot(snapshot, seq), (e) => { if (e.status !== 401 && seq === search.seq) $('results_status').textContent = e.message; });
}

/** Applies a snapshot of search `seq`; answers of an earlier search are dropped. */
function onSearchSnapshot(snapshot, seq) {
    if (seq !== search.seq) return;
    search.current = snapshot.id;
    search.snapshot = snapshot;
    renderResults();
    if (!snapshot.done) search.timer = setTimeout(() => pollSearch(seq), 500);
}

function pollSearch(seq) {
    search.timer = null;
    if (seq !== search.seq || search.current === null) return;
    getJson('/api/search', { id: search.current }).then((snapshot) => onSearchSnapshot(snapshot, seq), (e) => {
        if (seq !== search.seq || e.status === 404 || e.status === 401) return;
        search.timer = setTimeout(() => pollSearch(seq), 1500);
    });
}

function renderResults() {
    const snap = search.snapshot;
    if (!snap) return;
    const groups = snap.groups || [];
    const count = groups.reduce((sum, g) => sum + g.list.length, 0);
    $('results_status').textContent = snap.done
        ? (count ? `“${snap.keyword}” ${count} 个结果` : `“${snap.keyword}” 没有结果`)
        : `${count} 个结果 · 搜索中 ${snap.completed}/${snap.total}`;
    if (!groups.some((g) => g.site.key === search.filter)) search.filter = '';
    $('results_filters').innerHTML = groups.length
        ? [`<button class="chip${search.filter === '' ? ' active' : ''}" data-action="filter" data-value="">全部 (${count})</button>`]
            .concat(groups.map((g) => `<button class="chip${search.filter === g.site.key ? ' active' : ''}" data-action="filter" data-value="${esc(g.site.key)}">${esc(g.site.name || g.site.key)} (${g.list.length})</button>`))
            .join('')
        : '';
    const rows = [];
    groups.forEach((g) => {
        if (search.filter && g.site.key !== search.filter) return;
        g.list.forEach((vod) => rows.push(vodRow(g.site, vod, search.filter ? meta([vod.year, vod.remarks]) : meta([g.site.name || g.site.key, vod.year, vod.remarks]))));
    });
    $('results_list').innerHTML = rows.join('');
}

function vodRow(site, vod, sub) {
    return `<button class="vod-row" data-action="detail" data-site="${esc(site.key)}" data-id="${esc(vod.id)}">
    ${poster(vod.pic)}
    <div class="vod-info"><div class="vod-name">${esc(vod.name)}</div><div class="vod-meta">${esc(sub)}</div></div>
    </button>`;
}

function searchOnTv() {
    const word = $('search_input').value.trim();
    if (!word) return;
    act('search', { do: 'open', word }, () => toast('已在电视上搜索'));
}

function pushLink() {
    const url = $('search_input').value.trim();
    if (!url) return;
    act('push', { url }, () => { toast('已推送到电视'); showTab('remote'); });
}

// ── detail sheet ──

const detail = { data: null, flag: 0 };

function openDetail(siteKey, vodId) {
    loading(true);
    getJson('/api/detail', { site: siteKey, id: vodId }).then((data) => {
        loading(false);
        detail.data = data;
        detail.flag = Math.max(0, data.flags.findIndex((f) => f.flag === (data.resume && data.resume.flag)));
        renderDetail();
        $('detail_body').scrollTop = 0;
        openOverlay('detail_sheet');
    }, (e) => { loading(false); if (e.status !== 401) toast(e.message); });
}

function renderDetail() {
    const d = detail.data;
    const vod = d.vod;
    const flag = d.flags[detail.flag];
    const resume = d.resume;
    const resumeFlag = resume && d.flags.find((item) => item.flag === resume.flag);
    const resumeEpisode = resumeFlag && resumeFlag.episodes.find((item) => item.url === resume.episodeUrl);
    const resumeName = resumeEpisode ? resumeEpisode.name : '';
    const first = d.flags.find((f) => f.episodes.length > 0);
    const people = [['导演', vod.director], ['主演', vod.actor]].filter(([, v]) => v);
    $('detail_body').innerHTML = `
    <div class="detail-head">${poster(vod.pic)}
      <div class="vod-info"><div class="detail-title">${esc(vod.name)}</div>
      <div class="detail-tags">${esc(meta([d.site.name || d.site.key, vod.type, vod.area, vod.year]))}${vod.remarks ? '<br>' + esc(vod.remarks) : ''}</div></div>
    </div>
    <div class="detail-actions">
      ${resume ? `<button class="filled-btn" data-action="play" data-flag="${esc(resume.flag)}" data-url="${esc(resume.episodeUrl)}" data-position="${resume.position}">继续播放 ${esc(resumeName)}${resume.position > 0 ? ' · ' + formatTime(resume.position) : ''}</button>`
        : first ? `<button class="filled-btn" data-action="play" data-flag="${esc(first.flag)}" data-url="${esc(first.episodes[0].url)}">播放 ${esc(first.episodes[0].name)}</button>`
        : '<div class="empty">没有可播放的剧集</div>'}
    </div>
    ${d.flags.length > 1 ? `<div class="chips">${d.flags.map((f, i) => `<button class="chip${i === detail.flag ? ' active' : ''}" data-action="flag" data-value="${i}">${esc(f.flag)}</button>`).join('')}</div>` : ''}
    ${flag ? `<div class="episodes">${flag.episodes.map((e) => `<button class="episode${resume && resume.flag === flag.flag && resume.episodeUrl === e.url ? ' active' : ''}" data-action="play" data-flag="${esc(flag.flag)}" data-url="${esc(e.url)}" title="${esc(e.name)}">${esc(e.name)}</button>`).join('')}</div>` : ''}
    ${people.length ? `<div class="detail-people">${people.map(([k, v]) => `<div><b>${k}</b>${esc(v)}</div>`).join('')}</div>` : ''}
    ${vod.content ? `<div class="detail-content">${esc(vod.content.replace(/<[^>]+>/g, ''))}</div>` : ''}`;
}

function playEpisode(flag, url, position) {
    const d = detail.data;
    if (!d) return;
    vibrate();
    const params = { site: d.site.key, id: d.vod.id, flag, url };
    if (position) params.position = position;
    act('play', params, () => {
        closeOverlay('detail_sheet');
        toast('已在电视上播放');
        setTimeout(pollPlayer, 1500);
    });
}

// ── library ──

function loadLibrary() {
    getJson('/api/library').then(renderLibrary, (e) => { if (e.status !== 401) $('library_history').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
}

function renderLibrary(data) {
    const history = data.history || [];
    const keeps = data.keeps || [];
    $('library_history').innerHTML = history.length
        ? history.map((item) => {
            const progress = item.duration > 0 && item.position > 0 ? Math.min(100, Math.round((item.position / item.duration) * 100)) : undefined;
            const sub = meta([item.siteName, item.remarks, progress !== undefined ? `${formatTime(item.position)} / ${formatTime(item.duration)}` : '']);
            return `<button class="vod-row" data-action="resume" data-site="${esc(item.siteKey)}" data-id="${esc(item.id)}" data-flag="${esc(item.flag || '')}" data-url="${esc(item.episodeUrl || '')}" data-position="${item.position > 0 ? item.position : ''}">
            ${poster(item.pic)}
            <div class="vod-info"><div class="vod-name">${esc(item.name)}</div><div class="vod-meta">${esc(sub)}</div>
            ${progress !== undefined ? `<div class="vod-progress"><div class="vod-progress-bar" style="width:${progress}%"></div></div>` : ''}</div>
            </button>`;
        }).join('')
        : '<div class="empty">还没有观看记录</div>';
    $('library_keeps').innerHTML = keeps.length
        ? keeps.map((item) => `<button class="poster-card" data-action="detail" data-site="${esc(item.siteKey)}" data-id="${esc(item.id)}">${poster(item.pic)}<div class="vod-name">${esc(item.name)}</div><div class="vod-meta">${esc(item.siteName)}</div></button>`).join('')
        : '<div class="empty">还没有收藏</div>';
}

function resumeHistory(el) {
    vibrate();
    const params = { site: el.dataset.site, id: el.dataset.id };
    if (el.dataset.flag && el.dataset.url) { params.flag = el.dataset.flag; params.url = el.dataset.url; }
    if (el.dataset.position) params.position = el.dataset.position;
    act('play', params, () => { toast('已在电视上播放'); setTimeout(pollPlayer, 1500); });
}

// ── state (more tab) ──

function loadState() {
    getJson('/api/state').then((state) => {
        paired = true;
        renderConfigs(state);
        renderSources(state);
        renderSettings(state);
        renderEnroll(state);
        renderDevices(state);
        renderPlayer(state.player);
        $('cache_size').textContent = state.cache || '';
        $('version').textContent = `版本 ${state.version} · ${state.address}`;
    }, (e) => { if (e.status !== 401) toast(e.message); });
}

function renderConfigs(state) {
    [['vod', 0], ['live', 1]].forEach(([key, type]) => {
        const group = state[key] || { items: [], current: '' };
        $('config_list_' + type).innerHTML = group.items.length
            ? group.items.map((item) => `<button class="list-row${item.url === group.current ? ' active' : ''}" data-action="config" data-long="delete-config" data-type="${type}" data-url="${esc(item.url)}">
                <div class="row-info"><div class="row-name">${esc(item.name || item.url)}</div><div class="row-sub">${esc(item.name ? item.url : '')}</div></div>
                ${item.url === group.current ? '<span class="badge">使用中</span>' : ''}</button>`).join('')
            : '<div class="empty">尚未添加</div>';
    });
}

function useConfig(type, url, name) {
    loading(true);
    api('config', { do: 'use', type, url, name: name || '' }).then(
        () => setTimeout(() => { loading(false); loadState(); }, 1500),
        (e) => { loading(false); if (e.status !== 401) toast(e.message); },
    );
}

async function deleteConfig(type, url) {
    if (!(await confirmDialog('删除配置', url, { danger: true, ok: '删除' }))) return;
    act('config', { do: 'delete', type, url }, loadState);
}

function renderSources(state) {
    const s = state.sources || {};
    const fill = (name, items, current) => {
        items = items || [];
        $('source_' + name + '_row').classList.toggle('hidden', items.length === 0);
        $('source_' + name).innerHTML = items.map((i) => `<option value="${esc(i.key)}"${i.key === current ? ' selected' : ''}>${esc(i.name || i.key)}</option>`).join('');
    };
    fill('site', s.sites, s.site);
    fill('live', s.lives, s.live);
    fill('parse', s.parses, s.parse);
}

function setSource(action, value) {
    act('source', { do: action, value: value || '' }, () => { toast('已切换'); setTimeout(loadState, 800); });
}

const GROUP_TITLES = { general: '通用', player: '播放器', speed: '倍速', decode: '解码', preload: '预加载', danmaku: '弹幕', live: '直播' };

function renderSettings(state) {
    $('settings_groups').innerHTML = (state.settings || []).map((group) =>
        `<div class="section"><div class="section-title">${esc(GROUP_TITLES[group.key] || group.key)}</div>${group.items.map(settingRow).join('')}</div>`).join('');
}

function settingRow(item) {
    const key = esc(item.key);
    const label = `<span>${esc(item.label)}</span>`;
    if (item.type === 'bool') return `<label class="setting-row">${label}<input type="checkbox"${item.value ? ' checked' : ''} data-setting="${key}" /></label>`;
    if (item.type === 'enum') {
        const options = item.options.map((o, i) => `<option value="${i}"${i === item.value ? ' selected' : ''}>${esc(o)}</option>`).join('');
        return `<label class="setting-row">${label}<select class="select" data-setting="${key}">${options}</select></label>`;
    }
    if (item.type === 'number') return `<label class="setting-row">${label}<input class="select" type="number" min="${item.min}" max="${item.max}" step="${item.step}" value="${item.value}" data-setting="${key}" /></label>`;
    return `<div class="setting-text">${label}<form class="field-row" data-setting-form="${key}"><input class="text-input" type="text" value="${esc(item.value)}" /><button class="tonal-btn" type="submit">保存</button></form></div>`;
}

function setSetting(key, value) {
    api('setting', { key, value }).then(
        () => { toast('已保存'); setTimeout(loadState, 300); },
        (e) => { if (e.status !== 401) { toast('取值无效'); loadState(); } },
    );
}

function renderEnroll(state) {
    const e = state.enroll;
    const available = !!(e && e.available);
    $('enroll_section').classList.toggle('hidden', !available);
    if (!available) return;
    const labels = { off: '未关联', pending: '等待批准', linked: '已关联' };
    $('enroll_code').textContent = e.code;
    $('enroll_state').textContent = labels[e.state] || e.state;
    $('enroll_request').classList.toggle('hidden', e.state !== 'off');
    $('enroll_refresh').classList.toggle('hidden', e.state === 'off');
    $('enroll_unlink').classList.toggle('hidden', e.state === 'off');
}

async function enroll(action) {
    if (action === 'unlink' && !(await confirmDialog('取消关联', '取消关联后电视将停止同步服务器配置，并生成新的设备编码。', { danger: true, ok: '取消关联' }))) return;
    act('enroll', { do: action }, () => {
        toast(action === 'request' ? '已提交申请' : action === 'refresh' ? '已刷新' : '已取消关联');
        setTimeout(loadState, 800);
    });
}

function renderDevices(state) {
    const devices = state.devices || [];
    $('device_list').innerHTML = devices.length
        ? devices.map((item) => `<button class="list-row${item.token === state.token ? ' active' : ''}" data-action="device" data-target="${esc(item.token)}" data-name="${esc(item.name)}">
            <div class="row-info"><div class="row-name">${esc(item.name)}</div><div class="row-sub">${esc(item.ip)} · 最近 ${formatDate(item.last)}</div></div>
            ${item.token === state.token ? '<span class="badge">本机</span>' : ''}</button>`).join('')
        : '<div class="empty">尚无设备</div>';
}

async function deleteDevice(target, name) {
    if (!(await confirmDialog('删除设备', `是否删除设备 ${name}？删除后该设备需要重新配对。`, { danger: true, ok: '删除' }))) return;
    act('unpair', { target }, () => { if (target === token()) onUnauthorized(); else loadState(); });
}

// ── files ──

const files = { root: '', parent: '.' };

function fileRow(icon, name, sub, attrs) {
    return `<button class="list-row" ${attrs}><img class="row-icon" src="${icon}" alt=""><div class="row-info"><div class="row-name">${esc(name)}</div>${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}</div></button>`;
}

function listFiles(path) {
    const timer = setTimeout(() => loading(true), 200);
    fetch('/file' + path, { headers: headers() }).then(async (res) => {
        clearTimeout(timer);
        loading(false);
        if (res.status === 401) { onUnauthorized(); return; }
        let info;
        try { info = JSON.parse(await res.text()); } catch { toast('响应格式错误'); return; }
        files.root = path;
        files.parent = info.parent;
        $('files_title').textContent = path ? path.split('/').filter(Boolean).pop() : '文件';
        if (path === '' && info.files.length === 0) toast('可能没有存储权限');
        $('file_list').innerHTML = (info.parent !== '.' ? fileRow(IC_DIR, '..', '', `data-action="dir" data-path="${esc(info.parent)}"`) : '')
            + info.files.map((node) => node.dir === 1
                ? fileRow(IC_DIR, node.name, node.time, `data-action="dir" data-long="delete-folder" data-path="${esc(node.path)}"`)
                : fileRow(IC_FILE, node.name, node.time, `data-action="file" data-long="delete-file" data-path="${esc(node.path)}"`)).join('');
    }, () => { clearTimeout(timer); loading(false); toast('加载失败'); });
}

async function useFile(path) {
    if (!(await confirmDialog('本地路径', 'file:/' + path, { ok: '用作配置' }))) return;
    act('file', { path: 'file:/' + path }, () => toast('已加载'));
}

function fileAction(url, body, failMessage) {
    loading(true);
    return fetch(url, { method: 'POST', headers: headers(), body }).then(
        (res) => { loading(false); if (res.status === 401) onUnauthorized(); else if (!res.ok) toast(failMessage); },
        () => { loading(false); toast(failMessage); },
    );
}

function onFilesSelected() {
    const input = $('file_uploader');
    const selected = Array.from(input.files);
    if (!selected.length) return;
    confirmDialog('确认上传？', selected.map((f) => f.name).join(', ')).then((yes) => {
        if (!yes) { input.value = ''; return; }
        const form = new FormData();
        form.append('path', files.root);
        selected.forEach((f, i) => form.append('files-' + i, f));
        fileAction('/upload', form, '上传失败').then(() => { input.value = ''; listFiles(files.root); });
    });
}

function createFolder() {
    const name = $('folder_name').value.trim();
    $('folder_name').value = '';
    closeOverlay('folder_dialog');
    if (!name) return;
    fileAction('/newFolder', new URLSearchParams({ path: files.root, name }), '新建失败').then(() => listFiles(files.root));
}

async function deleteEntry(kind, path) {
    const folder = kind === 'delete-folder';
    if (!(await confirmDialog(folder ? '删除文件夹' : '删除文件', path, { danger: true, ok: '删除' }))) return;
    fileAction(folder ? '/delFolder' : '/delFile', new URLSearchParams({ path }), '删除失败').then(() => listFiles(files.root));
}

// ── long press ──

let pressTimer = null;
let pressed = false;
let pressStart = null;

function startPress(el, event) {
    pressed = false;
    cancelPress();
    pressStart = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => {
        pressed = true;
        vibrate();
        const kind = el.dataset.long;
        if (kind === 'delete-config') deleteConfig(el.dataset.type, el.dataset.url);
        else if (kind === 'delete-folder' || kind === 'delete-file') deleteEntry(kind, el.dataset.path);
    }, 500);
}

function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
}

// ── events ──

function onAction(el) {
    const d = el.dataset;
    switch (d.action) {
        case 'noop': return;
        case 'tab': showTab(d.tab); return;
        case 'control': control(d.do, d.value); return;
        case 'key': sendKey(d.value); return;
        case 'volume': sendVolume(d.value); return;
        case 'word': submitSearch(d.word); return;
        case 'filter': search.filter = d.value; renderResults(); return;
        case 'search-tv': searchOnTv(); return;
        case 'push-link': pushLink(); return;
        case 'detail': openDetail(d.site, d.id); return;
        case 'resume': resumeHistory(el); return;
        case 'refresh-library': loadLibrary(); return;
        case 'flag': detail.flag = Number(d.value); renderDetail(); return;
        case 'play': playEpisode(d.flag, d.url, d.position ? Number(d.position) : undefined); return;
        case 'close-sheet': closeOverlay('detail_sheet'); return;
        case 'close-dialog': closeOverlay(d.value); return;
        case 'confirm': closeOverlay('confirm_dialog'); settleConfirm(d.value === '1'); return;
        case 'config': if (!pressed) useConfig(d.type, d.url); return;
        case 'device': deleteDevice(d.target, d.name); return;
        case 'enroll': enroll(d.do); return;
        case 'files': showTab('files'); return;
        case 'files-back': history.back(); return;
        case 'upload': $('file_uploader').click(); return;
        case 'new-folder': openOverlay('folder_dialog'); setTimeout(() => $('folder_name').focus(), 50); return;
        case 'dir': if (!pressed) listFiles(d.path); return;
        case 'file': if (!pressed) useFile(d.path); return;
        default: return;
    }
}

document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (el) onAction(el);
});

document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.setting !== undefined) { setSetting(el.dataset.setting, el.type === 'checkbox' ? el.checked : el.value); return; }
    if (el.dataset.action === 'source') { setSource(el.dataset.do, el.value); return; }
    if (el.dataset.action === 'speed') { control('speed', el.value); return; }
    if (el.id === 'file_uploader') onFilesSelected();
});

document.addEventListener('submit', (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.id === 'search_form') submitSearch();
    else if (form.id === 'remote_form') sendText();
    else if (form.id === 'pair_form') confirmPair();
    else if (form.id === 'folder_form') createFolder();
    else if (form.dataset.config !== undefined) {
        const [name, url] = form.querySelectorAll('input');
        if (!url.value.trim()) { toast('请输入地址'); return; }
        const values = { name: name.value.trim(), url: url.value.trim() };
        name.value = ''; url.value = '';
        useConfig(form.dataset.config, values.url, values.name);
    } else if (form.dataset.settingForm !== undefined) setSetting(form.dataset.settingForm, form.querySelector('input').value);
});

document.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('[data-long]');
    if (el) startPress(el, event);
});
['pointerup', 'pointercancel'].forEach((type) => document.addEventListener(type, cancelPress));
document.addEventListener('pointermove', (event) => {
    if (pressTimer && pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10) cancelPress();
});
document.addEventListener('contextmenu', (event) => { if (event.target.closest('[data-long]')) event.preventDefault(); });

$('np_seek').addEventListener('input', function () { seeking = true; $('np_position').textContent = formatTime(Number(this.value)); });
$('np_seek').addEventListener('change', function () { seeking = false; control('seekto', this.value); });
$('search_input').addEventListener('input', onSearchInput);
$('search_clear').addEventListener('click', clearSearch);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPlayer(); });

// ── start ──

// Opened from the QR code as /?<device id>/<key>: the phone's token for this TV is the one in the shared cookie, else
// the one this address kept, else the key (the TV turns it into this phone's token on first use). The key stays for
// the tab in case the TV refuses the saved token. Both leave the address bar at once.
const opened = new URLSearchParams(location.search);
const link = /^\?([0-9a-z-]{1,64})\/([0-9a-f]{32,128})$/i.exec(location.search);
if (link) {
    localStorage.setItem('device', link[1]);
    opened.delete(link[1] + '/' + link[2]);
    const saved = savedToken() || token();
    if (saved && saved !== link[2]) sessionStorage.setItem('key', link[2]);
    saveToken(saved || link[2]);
}
history.replaceState(null, '', location.pathname + (opened.toString() ? '?' + opened : ''));
paired = !!token();
showTab(opened.get('tab') || 'remote', true);
loadState();
playerTimer = setInterval(pollPlayer, 2000);
if (!paired) showPairDialog();
