package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.api.config.LiveConfig;
import com.fongmi.android.tv.api.config.VodConfig;
import com.fongmi.android.tv.api.config.WallConfig;
import com.fongmi.android.tv.bean.Config;
import com.fongmi.android.tv.event.ServerEvent;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class ConfigApi implements Endpoint {

    static final int VOD = 0;
    static final int LIVE = 1;
    static final int WALL = 2;

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        int type = Integer.parseInt(params.get("type"));
        String url = Objects.toString(params.get("url"), "").trim();
        String name = Objects.toString(params.get("name"), "").trim();
        if (url.isEmpty()) return Reply.badRequest("url required");
        switch (Objects.toString(params.get("do"), "")) {
            case "use" -> ServerEvent.config(name.isEmpty() ? Config.find(url, type) : Config.find(url, name, type));
            case "delete" -> {
                if (url.equals(current(type).getUrl())) return Reply.badRequest("config in use");
                Config.find(url, type).delete();
            }
            default -> {
                return Reply.badRequest("Unknown do");
            }
        }
        return Reply.ok();
    }

    private static Config current(int type) {
        return switch (type) {
            case LIVE -> LiveConfig.get().getConfig();
            case WALL -> WallConfig.get().getConfig();
            default -> VodConfig.get().getConfig();
        };
    }
}
