package com.fongmi.android.tv.server.api;

import android.text.TextUtils;

import com.fongmi.android.tv.BuildConfig;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.api.config.LiveConfig;
import com.fongmi.android.tv.api.config.VodConfig;
import com.fongmi.android.tv.api.config.WallConfig;
import com.fongmi.android.tv.bean.Config;
import com.fongmi.android.tv.player.PlayerManager;
import com.fongmi.android.tv.server.Pairing;
import com.fongmi.android.tv.server.Server;
import com.fongmi.android.tv.service.PlaybackService;
import com.fongmi.android.tv.setting.PlayerSetting;
import com.fongmi.android.tv.setting.Setting;
import com.fongmi.android.tv.setting.SpeedSetting;
import com.fongmi.android.tv.utils.ResUtil;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.Map;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class StateApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        JsonObject object = new JsonObject();
        object.addProperty("version", BuildConfig.VERSION_NAME);
        object.addProperty("address", Server.get().getAddress());
        object.addProperty("token", Pairing.token(session));
        object.add("devices", PairApi.devices());
        object.add("vod", configs(ConfigApi.VOD, VodConfig.get().getConfig()));
        object.add("live", configs(ConfigApi.LIVE, LiveConfig.get().getConfig()));
        object.add("wall", configs(ConfigApi.WALL, WallConfig.get().getConfig()));
        object.add("settings", settings());
        object.add("options", options());
        object.add("player", Reply.onMain(StateApi::player, new JsonObject()));
        return Reply.json(object);
    }

    private static JsonObject configs(int type, Config current) {
        JsonArray items = new JsonArray();
        for (Config config : Config.getAll(type)) {
            JsonObject item = new JsonObject();
            item.addProperty("url", config.getUrl());
            item.addProperty("name", config.getName());
            item.addProperty("time", config.getTime());
            items.add(item);
        }
        JsonObject object = new JsonObject();
        object.addProperty("current", current.getUrl());
        object.add("items", items);
        return object;
    }

    private static JsonObject settings() {
        JsonObject object = new JsonObject();
        object.addProperty("engine", PlayerSetting.getEngine());
        object.addProperty("render", PlayerSetting.getRender());
        object.addProperty("scale", PlayerSetting.getScale());
        object.addProperty("background", PlayerSetting.getBackground());
        object.addProperty("buffer", PlayerSetting.getBuffer());
        object.addProperty("speed", SpeedSetting.getPlayback());
        object.addProperty("ua", Setting.getUa());
        object.addProperty("incognito", Setting.isIncognito());
        object.addProperty("adblock", Setting.isAdblock());
        return object;
    }

    private static JsonObject options() {
        JsonObject object = new JsonObject();
        object.add("engine", array(R.array.select_engine));
        object.add("render", array(R.array.select_render));
        object.add("scale", array(R.array.select_scale));
        return object;
    }

    private static JsonArray array(int resId) {
        JsonArray array = new JsonArray();
        for (String item : ResUtil.getStringArray(resId)) array.add(item);
        return array;
    }

    private static JsonObject player() {
        JsonObject object = new JsonObject();
        PlaybackService service = Server.get().getService();
        PlayerManager player = service == null ? null : service.player();
        boolean active = player != null && !TextUtils.isEmpty(player.getUrl());
        object.addProperty("active", active);
        if (!active) return object;
        object.addProperty("playing", player.isPlaying());
        object.addProperty("title", player.getMediaTitle());
        object.addProperty("position", Math.max(0, player.getPosition()));
        object.addProperty("duration", Math.max(0, player.getDuration()));
        object.addProperty("speed", player.getSpeed());
        return object;
    }
}
