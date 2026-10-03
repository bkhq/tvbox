package com.fongmi.android.tv.server.api;

import android.text.TextUtils;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.airplay.AirPlay;
import com.fongmi.android.tv.api.config.VodConfig;
import com.fongmi.android.tv.event.RefreshEvent;
import com.fongmi.android.tv.player.mpv.MpvUtil;
import com.fongmi.android.tv.setting.DanmakuSetting;
import com.fongmi.android.tv.setting.DecodeSetting;
import com.fongmi.android.tv.setting.LiveSetting;
import com.fongmi.android.tv.setting.PlayerSetting;
import com.fongmi.android.tv.setting.PreloadSetting;
import com.fongmi.android.tv.setting.Setting;
import com.fongmi.android.tv.setting.SpeedSetting;
import com.fongmi.android.tv.utils.ResUtil;
import com.github.catvod.bean.Doh;
import com.github.catvod.net.OkHttp;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Every setting the TV settings screens offer, described once so the phone control page can show
 * and change them all. Items carry their label, type, range or options, current value and the
 * same side effects the TV screens apply.
 */
public final class SettingRegistry {

    private enum Type {BOOL, ENUM, NUMBER, TEXT}

    private static final class Item {

        final String group;
        final String key;
        final String label;
        final Type type;
        final Supplier<Object> getter;
        final Consumer<String> setter;
        Supplier<List<String>> options = List::of;
        BooleanSupplier visible = () -> true;
        double min, max, step = 1;

        Item(String group, String key, String label, Type type, Supplier<Object> getter, Consumer<String> setter) {
            this.group = group;
            this.key = key;
            this.label = label;
            this.type = type;
            this.getter = getter;
            this.setter = setter;
        }

        Item options(int arrayRes) {
            options = () -> List.of(ResUtil.getStringArray(arrayRes));
            return this;
        }

        Item options(Supplier<List<String>> supplier) {
            options = supplier;
            return this;
        }

        Item range(double min, double max, double step) {
            this.min = min;
            this.max = max;
            this.step = step;
            return this;
        }

        Item visible(BooleanSupplier visible) {
            this.visible = visible;
            return this;
        }
    }

    private static final Map<String, Item> ITEMS = new LinkedHashMap<>();

    private SettingRegistry() {
    }

    private static Item add(String group, String key, int label, Type type, Supplier<Object> getter, Consumer<String> setter) {
        Item item = new Item(group, key, ResUtil.getString(label), type, getter, setter);
        ITEMS.put(key, item);
        return item;
    }

    private static Item bool(String group, String key, int label, Supplier<Boolean> getter, Consumer<Boolean> setter) {
        return add(group, key, label, Type.BOOL, getter::get, value -> setter.accept(Boolean.parseBoolean(value)));
    }

    private static Item choice(String group, String key, int label, Supplier<Integer> getter, Consumer<Integer> setter) {
        return add(group, key, label, Type.ENUM, getter::get, value -> setter.accept(Integer.parseInt(value)));
    }

    private static Item number(String group, String key, int label, Supplier<Number> getter, Consumer<Double> setter) {
        return add(group, key, label, Type.NUMBER, getter::get, value -> setter.accept(Double.parseDouble(value)));
    }

    private static Item text(String group, String key, int label, Supplier<String> getter, Consumer<String> setter) {
        return add(group, key, label, Type.TEXT, getter::get, setter);
    }

    static {
        // General
        bool("general", "incognito", R.string.setting_incognito, Setting::isIncognito, Setting::putIncognito);
        choice("general", "size", R.string.setting_size, PlayerSetting::getSize, value -> {
            PlayerSetting.putSize(value);
            App.post(RefreshEvent::size);
        }).options(R.array.select_size);
        choice("general", "doh", R.string.setting_doh, SettingRegistry::getDohIndex, SettingRegistry::setDoh).options(SettingRegistry::getDohNames);
        bool("general", "airplay", R.string.setting_airplay, Setting::isAirPlay, value -> {
            Setting.putAirPlay(value);
            if (value) AirPlay.get().start();
            else AirPlay.get().stop();
        });
        text("general", "airplay_name", R.string.airplay_name, AirPlay::getName, value -> {
            Setting.putAirPlayName(value.trim());
            if (Setting.isAirPlay()) AirPlay.get().restart();
        }).visible(Setting::isAirPlay);
        // Player
        choice("player", "engine", R.string.player_engine, PlayerSetting::getEngine, PlayerSetting::putEngine).options(R.array.select_engine);
        choice("player", "render", R.string.player_render, PlayerSetting::getRender, PlayerSetting::putRender).options(R.array.select_render);
        choice("player", "scale", R.string.player_scale, PlayerSetting::getScale, PlayerSetting::putScale).options(R.array.select_scale);
        choice("player", "background", R.string.player_background, PlayerSetting::getBackground, PlayerSetting::putBackground).options(R.array.select_background);
        number("player", "buffer", R.string.player_buffer, PlayerSetting::getBuffer, value -> PlayerSetting.putBuffer(value.intValue())).range(1, 10, 1).visible(PlayerSetting::isExo);
        bool("player", "adblock", R.string.player_adblock, Setting::isAdblock, Setting::putAdblock).visible(PlayerSetting::isExo);
        bool("player", "mpv_gpu_next", R.string.player_mpv_gpu_next, PlayerSetting::isMpvGpuNext, PlayerSetting::putMpvGpuNext).visible(PlayerSetting::isMpv);
        bool("player", "mpv_vulkan", R.string.player_mpv_vulkan, PlayerSetting::isMpvVulkan, PlayerSetting::putMpvVulkan).visible(() -> PlayerSetting.isMpv() && MpvUtil.isVulkanSupported());
        text("player", "ua", R.string.player_ua, Setting::getUa, Setting::putUa);
        // Speed
        number("speed", "speed", R.string.speed_setting_current, SpeedSetting::getPlayback, value -> SpeedSetting.putPlayback(value.floatValue())).range(SpeedSetting.MIN, SpeedSetting.MAX, 0.05);
        number("speed", "long_press", R.string.speed_setting_long_press, SpeedSetting::getLongPress, value -> SpeedSetting.putLongPress(value.floatValue())).range(2, SpeedSetting.MAX, 0.05);
        bool("speed", "skip_silence", R.string.speed_setting_skip_silence, SpeedSetting::isSkipSilence, SpeedSetting::putSkipSilence);
        // Decode
        bool("decode", "tunnel", R.string.player_tunnel, DecodeSetting::isTunnel, DecodeSetting::putTunnel).visible(PlayerSetting::isExo);
        bool("decode", "audio_pass_through", R.string.player_audio_pass_through, DecodeSetting::isAudioPassThrough, DecodeSetting::putAudioPassThrough);
        bool("decode", "audio_prefer", R.string.player_audio_decode, DecodeSetting::isAudioPrefer, DecodeSetting::putAudioPrefer).visible(PlayerSetting::isExo);
        bool("decode", "video_prefer", R.string.player_video_decode, DecodeSetting::isVideoPrefer, DecodeSetting::putVideoPrefer).visible(PlayerSetting::isExo);
        bool("decode", "aac", R.string.player_aac_track, DecodeSetting::isPreferAAC, DecodeSetting::putPreferAAC).visible(PlayerSetting::isExo);
        choice("decode", "dolby_vision", R.string.player_dolby_vision_output, DecodeSetting::getDolbyVisionOutputPolicy, DecodeSetting::putDolbyVisionOutputPolicy).options(R.array.select_dolby_vision_output);
        // Preload
        bool("preload", "preload", R.string.player_preload, PreloadSetting::isEnabled, PreloadSetting::putEnabled);
        bool("preload", "preload_next", R.string.player_preload_next, PreloadSetting::isNextEpisodeEnabled, PreloadSetting::putNextEpisodeEnabled).visible(() -> PreloadSetting.isEnabled() && PlayerSetting.isExo());
        number("preload", "preload_threads", R.string.player_preload_threads, PreloadSetting::getThreads, value -> PreloadSetting.putThreads(value.intValue())).range(PreloadSetting.MIN_THREADS, PreloadSetting.MAX_THREADS, 1).visible(() -> PreloadSetting.isEnabled() && PlayerSetting.isExo());
        number("preload", "preload_size", R.string.player_preload_size, PreloadSetting::getSizeMb, value -> PreloadSetting.putSizeMb(value.intValue())).range(PreloadSetting.MIN_SIZE_MB, PreloadSetting.MAX_SIZE_MB, PreloadSetting.STEP_SIZE_MB).visible(() -> PreloadSetting.isEnabled() && PlayerSetting.isExo());
        number("preload", "preload_time", R.string.player_preload_time, PreloadSetting::getTimeSeconds, value -> PreloadSetting.putTimeSeconds(value.intValue())).range(PreloadSetting.MIN_TIME_SECONDS, PreloadSetting.MAX_TIME_SECONDS, 1).visible(PreloadSetting::isEnabled);
        // Danmaku
        bool("danmaku", "danmaku_load", R.string.danmaku_load, DanmakuSetting::isLoad, DanmakuSetting::putLoad);
        text("danmaku", "danmaku_api", R.string.danmaku_api, DanmakuSetting::getApiUrl, DanmakuSetting::putApiUrl).visible(DanmakuSetting::isLoad);
        bool("danmaku", "danmaku_auto", R.string.danmaku_auto_load, DanmakuSetting::isAuto, DanmakuSetting::putAuto).visible(() -> DanmakuSetting.isLoad() && !TextUtils.isEmpty(DanmakuSetting.getEffectiveApiUrl()));
        bool("danmaku", "danmaku_spider", R.string.danmaku_spider_first, DanmakuSetting::isSpiderFirst, DanmakuSetting::putSpiderFirst).visible(() -> DanmakuSetting.isLoad() && !TextUtils.isEmpty(DanmakuSetting.getEffectiveApiUrl()) && DanmakuSetting.isAuto());
        // Live
        bool("live", "live_change", R.string.play_change, LiveSetting::isChange, LiveSetting::putChange);
        bool("live", "live_invert", R.string.play_invert, LiveSetting::isInvert, LiveSetting::putInvert);
        bool("live", "live_across", R.string.play_across, LiveSetting::isAcross, LiveSetting::putAcross);
        bool("live", "live_boot", R.string.live_boot, LiveSetting::isBoot, LiveSetting::putBoot);
    }

    private static List<Doh> dohList() {
        return VodConfig.get().getDoh();
    }

    private static List<String> getDohNames() {
        List<String> names = new ArrayList<>();
        for (Doh doh : dohList()) names.add(doh.getName());
        return names;
    }

    private static int getDohIndex() {
        return Math.max(0, dohList().indexOf(Doh.objectFrom(Setting.getDoh())));
    }

    private static void setDoh(int index) {
        List<Doh> items = dohList();
        if (index < 0 || index >= items.size()) throw new IllegalArgumentException("Unknown doh");
        Doh doh = items.get(index);
        OkHttp.dns().setDoh(doh);
        Setting.putDoh(doh.toString());
    }

    /** All groups with their visible items, in screen order. */
    public static JsonArray toJson() {
        Map<String, JsonArray> groups = new LinkedHashMap<>();
        for (Item item : ITEMS.values()) {
            if (!item.visible.getAsBoolean()) continue;
            JsonObject object = new JsonObject();
            object.addProperty("key", item.key);
            object.addProperty("label", item.label);
            object.addProperty("type", item.type.name().toLowerCase(java.util.Locale.ROOT));
            Object value = item.getter.get();
            if (value instanceof Boolean b) object.addProperty("value", b);
            else if (value instanceof Number n) object.addProperty("value", n);
            else object.addProperty("value", value == null ? "" : value.toString());
            if (item.type == Type.ENUM) {
                JsonArray options = new JsonArray();
                for (String option : item.options.get()) options.add(option);
                object.add("options", options);
            }
            if (item.type == Type.NUMBER) {
                object.addProperty("min", item.min);
                object.addProperty("max", item.max);
                object.addProperty("step", item.step);
            }
            groups.computeIfAbsent(item.group, k -> new JsonArray()).add(object);
        }
        JsonArray result = new JsonArray();
        for (Map.Entry<String, JsonArray> entry : groups.entrySet()) {
            JsonObject group = new JsonObject();
            group.addProperty("key", entry.getKey());
            group.add("items", entry.getValue());
            result.add(group);
        }
        return result;
    }

    /** @return false when the key is unknown */
    public static boolean set(String key, String value) {
        Item item = ITEMS.get(key);
        if (item == null) return false;
        item.setter.accept(value);
        return true;
    }
}
