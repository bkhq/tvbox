package com.fongmi.android.tv.server.api;

import android.text.TextUtils;

import com.fongmi.android.tv.bean.Config;
import com.fongmi.android.tv.event.RefreshEvent;
import com.fongmi.android.tv.event.ServerEvent;
import com.fongmi.android.tv.utils.FileUtil;
import com.github.catvod.utils.Path;

import java.util.Map;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class ActionApi implements Endpoint {

    private final String action;

    private ActionApi(String action) {
        this.action = action;
    }

    public static ActionApi of(String action) {
        return new ActionApi(action);
    }

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        return switch (action) {
            case "push" -> push(params.get("url"));
            case "search" -> search(params.get("word"));
            case "file" -> file(params.get("path"));
            default -> Reply.notFound("Unknown action");
        };
    }

    private static Response push(String url) {
        if (TextUtils.isEmpty(url)) return Reply.badRequest("url required");
        ServerEvent.push(url);
        return Reply.ok();
    }

    private static Response search(String word) {
        if (TextUtils.isEmpty(word)) return Reply.badRequest("word required");
        ServerEvent.search(word);
        return Reply.ok();
    }

    private static Response file(String path) {
        if (TextUtils.isEmpty(path)) return Reply.badRequest("path required");
        if (path.endsWith(".apk")) FileUtil.openFile(Path.local(path));
        else if (path.endsWith(".srt") || path.endsWith(".ssa") || path.endsWith(".ass")) RefreshEvent.subtitle(path);
        else ServerEvent.config(Config.find(path, ConfigApi.VOD));
        return Reply.ok();
    }
}
