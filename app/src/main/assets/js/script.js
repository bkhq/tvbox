const icDir = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23F5A623'><path d='M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z'/></svg>`;
const icFile = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23717970'><path d='M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z'/></svg>`;
const PANELS = 4;
let currentRoot = '';
let currentFile = '';
let currentParent = '';
let currentPanel = 1;
let longPressTimer = null;
let longPressTriggered = false;
let pendingDelFolder = null;
let pendingDelConfig = null;
let warnToastTimer = null;
let playerTimer = null;
let dialogClosing = false;
let pendingDelDevice = null;
let paired = false;

// ── pairing ──

function token() {
    return localStorage.getItem('token') || '';
}

function applyToken() {
    $.ajaxSetup({ headers: { 'X-Token': token() } });
}

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
    if ($('#pairDialog').is(':visible')) return;
    stopPlayerPolling();
    $('#pair_code').val('');
    if (!$('#pair_name').val()) $('#pair_name').val(guessName());
    $('#pairDialog').show();
}

function confirmPair() {
    const code = $('#pair_code').val().trim();
    const name = $('#pair_name').val().trim();
    if (code.length !== 6) { warnToast('请输入 6 位配对码'); return; }
    $.post('/api/pair', { code, name }, function (res) {
        localStorage.setItem('token', res.token);
        applyToken();
        paired = true;
        $('#pairDialog').hide();
        warnToast('配对成功');
        loadState();
        if (currentPanel === 2) startPlayerPolling();
    }, 'json').fail(function (xhr) {
        warnToast(xhr.status === 403 ? '配对码错误' : (xhr.responseText || '配对失败'));
    });
}

function onUnauthorized() {
    localStorage.removeItem('token');
    applyToken();
    paired = false;
    showPairDialog();
}

function renderDevices(state) {
    const list = $('#device_list').empty();
    if (!state.devices.length) list.append('<div class="config-empty">尚无设备</div>');
    state.devices.forEach(item => {
        const self = item.token === state.token;
        const t = escPath(item.token);
        list.append(`<a class="file-item config-item${self ? ' active' : ''}" href="javascript:void(0)" ontouchstart="startLongPress(()=>showDelDeviceDialog('${t}','${escPath(item.name)}'))" ontouchmove="cancelLongPress()" ontouchend="cancelLongPress()" oncontextmenu="return false" onclick="if(!longPressTriggered)showDelDeviceDialog('${t}','${escPath(item.name)}')">
    <div class="file-info"><div class="file-name">${escHtml(item.name)}</div><div class="file-time">${escHtml(item.ip)} · 最近 ${formatDate(item.last)}</div></div>
    ${self ? '<span class="config-badge">本机</span>' : ''}
    </a>`);
    });
}

function formatDate(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showDelDeviceDialog(target, name) {
    pendingDelDevice = target;
    $('#delDeviceContent').text('是否删除设备 ' + name + '？删除后该设备需要重新配对。');
    openDialog('delDevice');
}

function confirmDelDevice(yes) {
    closeDialog('delDevice');
    const target = pendingDelDevice;
    pendingDelDevice = null;
    if (yes !== 1 || !target) return;
    api('unpair', { target }, function () {
        if (target === token()) onUnauthorized();
        else loadState();
    });
}

// ── state ──

function loadState(onDone) {
    $.getJSON('/api/state', function (state) {
        paired = true;
        renderConfigs(state);
        renderSettings(state);
        renderDevices(state);
        renderPlayer(state.player);
        $('#version').text('版本 ' + state.version + ' · ' + state.address);
        if (onDone) onDone(state);
    }).fail(function (xhr) {
        if (xhr.status === 401) onUnauthorized();
        else warnToast('连接电视失败');
    });
}

function api(path, kv, onDone) {
    $.post('/api/' + path, kv, function () {
        if (onDone) onDone();
    }).fail(function (xhr) {
        if (xhr.status === 401) onUnauthorized();
        else warnToast(xhr.responseText || '操作失败');
    });
}

// ── config ──

function renderConfigs(state) {
    [['vod', 0], ['live', 1], ['wall', 2]].forEach(([key, type]) => {
        const group = state[key];
        const list = $('#config_list_' + type).empty();
        if (!group.items.length) list.append('<div class="config-empty">尚未添加</div>');
        group.items.forEach(item => list.append(buildConfigItem(type, item, item.url === group.current)));
    });
}

function buildConfigItem(type, item, active) {
    const url = escPath(item.url);
    return `<a class="file-item config-item${active ? ' active' : ''}" href="javascript:void(0)" ontouchstart="startLongPress(()=>showDelConfigDialog(${type},'${url}'))" ontouchmove="cancelLongPress()" ontouchend="cancelLongPress()" oncontextmenu="return false" onclick="if(!longPressTriggered)useConfig(${type},'${url}')">
    <div class="file-info"><div class="file-name">${escHtml(item.name || item.url)}</div><div class="file-time">${escHtml(item.name ? item.url : '')}</div></div>
    ${active ? '<span class="config-badge">使用中</span>' : ''}
    </a>`;
}

function useConfig(type, url, name) {
    $('#loadingToast').show();
    api('config', { do: 'use', type, url, name: name || '' }, function () {
        setTimeout(() => { $('#loadingToast').hide(); loadState(); }, 1500);
    });
}

function addConfig(type) {
    const url = $('#config_url_' + type).val().trim();
    const name = type === 2 ? '' : $('#config_name_' + type).val().trim();
    if (!url) { warnToast('请输入地址'); return; }
    $('#config_url_' + type).val('');
    if (type !== 2) $('#config_name_' + type).val('');
    useConfig(type, url, name);
}

function showDelConfigDialog(type, url) {
    pendingDelConfig = { type, url };
    $('#delConfigContent').text('是否删除 ' + url);
    openDialog('delConfig');
}

function confirmDelConfig(yes) {
    closeDialog('delConfig');
    if (yes !== 1 || !pendingDelConfig) { pendingDelConfig = null; return; }
    const { type, url } = pendingDelConfig;
    pendingDelConfig = null;
    api('config', { do: 'delete', type, url }, loadState);
}

// ── player ──

function renderPlayer(player) {
    if (!player || !player.active) {
        $('#player_title').text('未在播放');
        $('#player_position').text('00:00');
        $('#player_duration').text('00:00');
        $('#player_toggle').text('播放');
        return;
    }
    $('#player_title').text(player.title || '正在播放');
    $('#player_position').text(formatTime(player.position));
    $('#player_duration').text(formatTime(player.duration));
    $('#player_toggle').text(player.playing ? '暂停' : '播放');
    const speed = String(Number(player.speed));
    if ($('#player_speed option[value="' + speed + '"]').length) $('#player_speed').val(speed);
}

function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function control(action, value) {
    api('control', { do: action, value: value === undefined ? '' : value }, function () {
        setTimeout(() => $.getJSON('/api/state', state => renderPlayer(state.player)), 300);
    });
}

function startPlayerPolling() {
    stopPlayerPolling();
    playerTimer = setInterval(() => { if (paired) $.getJSON('/api/state', state => renderPlayer(state.player)).fail(xhr => { if (xhr.status === 401) onUnauthorized(); }); }, 2000);
}

function stopPlayerPolling() {
    if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
}

function search() {
    api('search', { word: $('#keyword').val() });
}

function push() {
    api('push', { url: $('#push_url').val() });
}

// ── settings ──

function renderSettings(state) {
    const s = state.settings;
    ['engine', 'render', 'scale'].forEach(key => {
        const select = $('#setting_' + key).empty();
        state.options[key].forEach((label, i) => select.append(`<option value="${i}">${escHtml(label)}</option>`));
        select.val(String(s[key]));
    });
    $('#setting_background').val(String(s.background));
    $('#setting_buffer').val(s.buffer);
    $('#setting_speed').val(s.speed);
    $('#setting_ua').val(s.ua);
    $('#setting_incognito').prop('checked', s.incognito);
    $('#setting_adblock').prop('checked', s.adblock);
}

function setting(key, value) {
    api('setting', { key, value }, function () {
        warnToast('已保存');
        loadState();
    });
}

// ── common ──

function openDialog(id) {
    $('#' + id).show();
    history.pushState({ dialog: id }, '');
}

function closeDialog(id) {
    dialogClosing = true;
    $('#' + id).hide();
    history.back();
}

function startLongPress(callback) {
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        callback();
    }, 500);
}

function cancelLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function escPath(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── files ──

function buildParentItem() {
    return `<a class="file-item" href="javascript:void(0)" onclick="history.back()">
    <img class="file-icon" src="${icDir}" alt="">
    <div class="file-info"><div class="file-name">..</div></div>
    </a>`;
}

function buildDirItem(name, time, path) {
    const ep = escPath(path);
    return `<a class="file-item" href="javascript:void(0)" ontouchstart="startLongPress(()=>showDelFolderDialog('${ep}',currentRoot))" ontouchmove="cancelLongPress()" ontouchend="cancelLongPress()" oncontextmenu="return false" onclick="if(!longPressTriggered)listFile('${ep}',true)">
    <img class="file-icon" src="${icDir}" alt="">
    <div class="file-info"><div class="file-name">${escHtml(name)}</div><div class="file-time">${escHtml(time)}</div></div>
    </a>`;
}

function buildFileItem(name, time, path) {
    const ep = escPath(path);
    return `<a class="file-item" href="javascript:void(0)" ontouchstart="startLongPress(()=>showDelFileDialog('${ep}'))" ontouchmove="cancelLongPress()" ontouchend="cancelLongPress()" oncontextmenu="return false" onclick="if(!longPressTriggered)selectFile('${ep}')">
    <img class="file-icon" src="${icFile}" alt="">
    <div class="file-info"><div class="file-name">${escHtml(name)}</div><div class="file-time">${escHtml(time)}</div></div>
    </a>`;
}

function addFile(node) {
    $('#file_list').append(node);
}

function selectFile(path) {
    currentFile = path;
    $("#fileUrl").text("file:/" + path);
    openDialog('fileInfoDialog');
}

function pushFile(yes) {
    closeDialog('fileInfoDialog');
    if (yes === 1) api('file', { path: "file:/" + currentFile });
}

function listFile(path, addHistory = false) {
    const loadingTimer = setTimeout(() => $('#loadingToast').show(), 200);
    $.get('/file' + path, function (res) {
        clearTimeout(loadingTimer);
        let info;
        try {
            info = JSON.parse(res);
        } catch (e) {
            $('#loadingToast').hide();
            warnToast('响应格式错误');
            return;
        }
        const parent = info.parent;
        currentRoot = path;
        currentParent = parent;
        const array = info.files;
        if (path === '' && array.length === 0) warnToast('可能没有存储权限');
        $('#file_list').html('');
        if (parent !== '.') addFile(buildParentItem());
        array.forEach(node => {
            if (node.dir === 1) addFile(buildDirItem(node.name, node.time, node.path));
            else addFile(buildFileItem(node.name, node.time, node.path));
        });
        if (addHistory) history.pushState(path, '');
        $('#loadingToast').hide();
    }).fail(function () {
        clearTimeout(loadingTimer);
        $('#loadingToast').hide();
        warnToast('加载失败');
    });
}

function uploadFile() {
    $('#file_uploader').click();
}

function onFileSelected() {
    const files = $('#file_uploader')[0].files;
    if (files.length === 0) return;
    const tip = Array.from(files).map(f => f.name).join(', ');
    $('#uploadTipContent').text(tip);
    openDialog('uploadTip');
}

function confirmUpload(yes) {
    closeDialog('uploadTip');
    if (yes !== 1) return;
    const files = $('#file_uploader')[0].files;
    if (files.length === 0) return;
    const formData = new FormData();
    formData.append('path', currentRoot);
    Array.from(files).forEach((f, i) => formData.append('files-' + i, f));
    $('#loadingToast').show();
    $.ajax({
        url: '/upload',
        type: 'post',
        data: formData,
        processData: false,
        contentType: false,
        complete: function () {
            $('#loadingToast').hide();
            $('#file_uploader').val('');
            listFile(currentRoot);
        }
    });
}

function showNewFolderDialog() {
    openDialog('newFolder');
}

function confirmNewFolder(yes) {
    closeDialog('newFolder');
    const name = $('#newFolderContent').val().trim();
    $('#newFolderContent').val('');
    if (yes !== 1 || name.length === 0) return;
    $('#loadingToast').show();
    $.post('/newFolder', { path: currentRoot, name }, function () {
        $('#loadingToast').hide();
        listFile(currentRoot);
    }).fail(function () {
        $('#loadingToast').hide();
        warnToast('新建失败');
    });
}

function showDelFolderDialog(path, refreshPath) {
    pendingDelFolder = { path, refreshPath };
    $('#delFolderContent').text('是否删除 ' + path);
    openDialog('delFolder');
}

function confirmDelFolder(yes) {
    closeDialog('delFolder');
    if (yes !== 1 || !pendingDelFolder) { pendingDelFolder = null; return; }
    const { path, refreshPath } = pendingDelFolder;
    pendingDelFolder = null;
    $('#loadingToast').show();
    $.post('/delFolder', { path }, function () {
        $('#loadingToast').hide();
        listFile(refreshPath);
    }).fail(function () {
        $('#loadingToast').hide();
        warnToast('删除失败');
    });
}

function showDelFileDialog(path) {
    currentFile = path;
    $('#delFileContent').text('是否删除 ' + path);
    openDialog('delFile');
}

function confirmDelFile(yes) {
    closeDialog('delFile');
    if (yes !== 1) return;
    $('#loadingToast').show();
    $.post('/delFile', { path: currentFile }, function () {
        $('#loadingToast').hide();
        listFile(currentRoot);
    }).fail(function () {
        $('#loadingToast').hide();
        warnToast('删除失败');
    });
}

function warnToast(msg) {
    $('#warnToastContent').text(msg);
    $('#warnToast').show();
    if (warnToastTimer) clearTimeout(warnToastTimer);
    warnToastTimer = setTimeout(() => { $('#warnToast').hide(); warnToastTimer = null; }, 1000);
}

// ── navigation ──

function showPanel(id) {
    currentPanel = id;
    for (let i = 1; i <= PANELS; i++) {
        document.getElementById('panel' + i).classList.toggle('active', i === id);
        document.getElementById('tab' + i).classList.toggle('active', i === id);
    }
    if (id === 2) startPlayerPolling(); else stopPlayerPolling();
    if (id === 4 && document.getElementById('file_list').innerHTML === '') listFile('');
}

const tab = parseInt(new URLSearchParams(window.location.search).get('tab')) || 1;
history.replaceState(null, '');

window.addEventListener('popstate', function () {
    if (dialogClosing) { dialogClosing = false; return; }
    const visible = $('.md-dialog-overlay:visible').not('#pairDialog');
    if (visible.length) { visible.first().hide(); return; }
    if (currentPanel === 4) listFile(currentParent);
});

$(function () {
    applyToken();
    showPanel(Math.min(Math.max(tab, 1), PANELS));
    loadState();
    $('#pair_code, #pair_name').on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); confirmPair(); } });
    $('#keyword').on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); search(); } });
    $('#push_url').on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); push(); } });
    $('#setting_ua').on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); setting('ua', this.value); } });
    $('#newFolderContent').on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); confirmNewFolder(1); } });
    for (let t = 0; t < 3; t++) $('#config_url_' + t + ', #config_name_' + t).on('keydown', function (e) { if (e.key === 'Enter') { this.blur(); addConfig(t); } });
});
