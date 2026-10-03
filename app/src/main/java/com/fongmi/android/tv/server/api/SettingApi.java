package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.setting.PlayerSetting;
import com.fongmi.android.tv.setting.Setting;
import com.fongmi.android.tv.setting.SpeedSetting;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class SettingApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String key = Objects.toString(params.get("key"), "");
        String value = Objects.toString(params.get("value"), "");
        switch (key) {
            case "engine" -> PlayerSetting.putEngine(Integer.parseInt(value));
            case "render" -> PlayerSetting.putRender(Integer.parseInt(value));
            case "scale" -> PlayerSetting.putScale(Integer.parseInt(value));
            case "background" -> PlayerSetting.putBackground(Integer.parseInt(value));
            case "buffer" -> PlayerSetting.putBuffer(Integer.parseInt(value));
            case "speed" -> SpeedSetting.putPlayback(Float.parseFloat(value));
            case "ua" -> Setting.putUa(value);
            case "incognito" -> Setting.putIncognito(Boolean.parseBoolean(value));
            case "adblock" -> Setting.putAdblock(Boolean.parseBoolean(value));
            default -> {
                return Reply.badRequest("Unknown key");
            }
        }
        return Reply.ok();
    }
}
