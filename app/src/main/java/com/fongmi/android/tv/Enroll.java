package com.fongmi.android.tv;

import android.os.Build;
import android.text.TextUtils;

import com.fongmi.android.tv.airplay.AirPlay;
import com.fongmi.android.tv.bean.Config;
import com.fongmi.android.tv.event.ServerEvent;
import com.fongmi.android.tv.utils.DeviceId;
import com.fongmi.android.tv.utils.Notify;
import com.fongmi.android.tv.utils.Task;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Prefers;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.security.SecureRandom;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Optional link between this device and the worker. The user requests it from settings; the
 * device shows a random code that the admin approves in the console. The approved response
 * carries the device's subscription URL, which is loaded as the config.
 */
public final class Enroll {

    public enum State {OFF, PENDING, LINKED}

    private static final String KEY_ENABLED = "enroll";
    private static final String KEY_CODE = "enroll_code";
    private static final String KEY_SUBSCRIPTION = "enroll_subscription";
    private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final long POLL_SECONDS = 15;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private static volatile boolean running;

    private Enroll() {
    }

    public static boolean isAvailable() {
        return !TextUtils.isEmpty(BuildConfig.WORKER_URL);
    }

    public static State getState() {
        if (!Prefers.getBoolean(KEY_ENABLED)) return State.OFF;
        return TextUtils.isEmpty(Prefers.getString(KEY_SUBSCRIPTION)) ? State.PENDING : State.LINKED;
    }

    public static synchronized String getCode() {
        String code = Prefers.getString(KEY_CODE);
        if (TextUtils.isEmpty(code)) Prefers.put(KEY_CODE, code = newCode());
        return code;
    }

    /** Resumes polling or refreshes the subscription when the user has linked this device. */
    public static void start() {
        if (!isAvailable() || !Prefers.getBoolean(KEY_ENABLED) || running) return;
        running = true;
        Task.execute(Enroll::check);
    }

    public static void request() {
        Prefers.put(KEY_ENABLED, true);
        start();
    }

    public static void unlink() {
        Prefers.put(KEY_ENABLED, false);
        Prefers.remove(KEY_SUBSCRIPTION);
        String code = getCode();
        Prefers.put(KEY_CODE, newCode());
        Task.execute(() -> post("unlink", code));
    }

    private static void check() {
        if (!Prefers.getBoolean(KEY_ENABLED)) {
            running = false;
            return;
        }
        try (Response response = post("request", getCode())) {
            JsonObject result = response == null || response.body() == null ? new JsonObject() : JsonParser.parseString(response.body().string()).getAsJsonObject();
            String status = result.has("status") ? result.get("status").getAsString() : "";
            switch (status) {
                case "approved" -> apply(result.get("subscription").getAsString());
                case "pending" -> retry();
                case "rejected" -> {
                    running = false;
                    Prefers.put(KEY_ENABLED, false);
                    Prefers.remove(KEY_SUBSCRIPTION);
                }
                default -> retry();
            }
        } catch (Exception e) {
            e.printStackTrace();
            retry();
        }
    }

    private static Response post(String action, String code) {
        try {
            JsonObject object = new JsonObject();
            object.addProperty("action", action);
            object.addProperty("code", code);
            object.addProperty("deviceId", DeviceId.get());
            object.addProperty("name", AirPlay.getName());
            object.addProperty("model", Build.MANUFACTURER + " " + Build.MODEL);
            object.addProperty("mode", BuildConfig.FLAVOR_mode);
            object.addProperty("abi", BuildConfig.FLAVOR_abi);
            object.addProperty("versionCode", BuildConfig.VERSION_CODE);
            object.addProperty("versionName", BuildConfig.VERSION_NAME);
            return OkHttp.newCall(OkHttp.client(), BuildConfig.WORKER_URL + "/api/raw/tvbox/enroll", RequestBody.create(object.toString(), JSON)).execute();
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private static void apply(String subscription) {
        running = false;
        if (TextUtils.isEmpty(subscription)) return;
        boolean changed = !subscription.equals(Prefers.getString(KEY_SUBSCRIPTION));
        Prefers.put(KEY_SUBSCRIPTION, subscription);
        if (!changed) return;
        App.post(() -> {
            Notify.show(R.string.enroll_approved);
            ServerEvent.config(Config.find(subscription, 0));
        });
    }

    private static void retry() {
        if (Prefers.getBoolean(KEY_ENABLED)) Task.schedule(Enroll::check, POLL_SECONDS, TimeUnit.SECONDS);
        else running = false;
    }

    private static String newCode() {
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8; i++) {
            if (i == 4) sb.append('-');
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }
}
