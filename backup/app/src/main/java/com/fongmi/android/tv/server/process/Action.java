package com.fongmi.android.tv.server.process;

import android.text.TextUtils;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.bean.Vod;
import com.fongmi.android.tv.event.RefreshEvent;
import com.fongmi.android.tv.event.ServerEvent;
import com.fongmi.android.tv.server.Nano;
import com.fongmi.android.tv.server.PlayerCommand;
import com.fongmi.android.tv.server.Server;
import com.fongmi.android.tv.server.impl.Process;
import com.fongmi.android.tv.service.PlaybackService;
import com.fongmi.android.tv.utils.FileUtil;
import com.github.catvod.utils.Path;

import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class Action implements Process {

    @Override
    public boolean isRequest(IHTTPSession session, String url) {
        return url.startsWith("/action");
    }

    @Override
    public Response doResponse(IHTTPSession session, String url, Map<String, String> files) {
        Map<String, String> params = session.getParms();
        String param = params.get("do");
        if (!TextUtils.isEmpty(param)) doJob(param, params);
        return Nano.ok();
    }

    private void doJob(String param, Map<String, String> params) {
        switch (param) {
            case "file" -> onFile(params);
            case "push" -> onPush(params);
            case "search" -> onSearch(params);
            case "setting" -> onSetting(params);
            case "refresh" -> onRefresh(params);
            case "control" -> onControl(params);
            case "danmaku" -> onDanmaku(params);
        }
    }

    private void onFile(Map<String, String> params) {
        String path = params.get("path");
        if (TextUtils.isEmpty(path)) return;
        if (path.endsWith(".apk")) FileUtil.openFile(Path.local(path));
        else if (path.endsWith(".srt") || path.endsWith(".ssa") || path.endsWith(".ass")) RefreshEvent.subtitle(path);
        else ServerEvent.setting(path);
    }

    private void onPush(Map<String, String> params) {
        String url = params.get("url");
        if (TextUtils.isEmpty(url)) return;
        ServerEvent.push(url);
    }

    private void onSearch(Map<String, String> params) {
        String word = params.get("word");
        if (TextUtils.isEmpty(word)) return;
        ServerEvent.search(word);
    }

    private void onSetting(Map<String, String> params) {
        String text = params.get("text");
        String name = params.get("name");
        if (TextUtils.isEmpty(text)) return;
        ServerEvent.setting(text, name);
    }

    private void onRefresh(Map<String, String> params) {
        String type = params.get("type");
        String path = params.get("path");
        String json = params.get("json");
        if (TextUtils.isEmpty(type)) return;
        switch (type) {
            case "live" -> RefreshEvent.live();
            case "detail" -> RefreshEvent.detail();
            case "player" -> RefreshEvent.player();
            case "category" -> RefreshEvent.category();
            case "danmaku" -> RefreshEvent.danmaku(path);
            case "subtitle" -> RefreshEvent.subtitle(path);
            case "vod" -> RefreshEvent.vod(Vod.objectFrom(json));
        }
    }

    private void onControl(Map<String, String> params) {
        Consumer<PlaybackService> command;
        try {
            command = PlayerCommand.of(Objects.toString(params.get("type"), ""), Objects.toString(params.get("value"), "0"));
        } catch (IllegalArgumentException e) {
            return;
        }
        PlaybackService service = Server.get().getService();
        if (service == null || command == null) return;
        App.post(() -> command.accept(service));
    }

    private void onDanmaku(Map<String, String> params) {
        String text = params.get("text");
        PlaybackService service = Server.get().getService();
        if (service == null || TextUtils.isEmpty(text)) return;
        App.post(() -> service.player().sendDanmaku(text));
    }

}
