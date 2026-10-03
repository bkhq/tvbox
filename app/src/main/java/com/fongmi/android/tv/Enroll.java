package com.fongmi.android.tv;

import android.os.Build;
import android.text.TextUtils;

import com.fongmi.android.tv.airplay.AirPlay;
import com.fongmi.android.tv.api.config.VodConfig;
import com.fongmi.android.tv.bean.Config;
import com.fongmi.android.tv.event.ServerEvent;
import com.fongmi.android.tv.utils.DeviceId;
import com.fongmi.android.tv.utils.Notify;
import com.fongmi.android.tv.utils.ResUtil;
import com.fongmi.android.tv.utils.Task;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Prefers;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Registers this device with the worker on start. Once an admin approves it there, the worker
 * returns the device's subscription URL and the app loads it, so nothing has to be typed on the TV.
 * A config the user set by hand is never replaced.
 */
public final class Enroll {

    private static final String KEY_SUBSCRIPTION = "enroll_subscription";
    private static final long POLL_SECONDS = 15;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private static volatile boolean running;
    private static boolean notified;

    private Enroll() {
    }

    public static void start() {
        if (TextUtils.isEmpty(BuildConfig.WORKER_URL) || running) return;
        running = true;
        Task.execute(Enroll::check);
    }

    private static void check() {
        String current = VodConfig.getUrl();
        String enrolled = Prefers.getString(KEY_SUBSCRIPTION);
        if (!TextUtils.isEmpty(current) && !current.equals(enrolled)) {
            running = false;
            return;
        }
        try (Response response = OkHttp.newCall(OkHttp.client(), BuildConfig.WORKER_URL + "/api/raw/tvbox/enroll", RequestBody.create(body(), JSON)).execute()) {
            JsonObject result = response.body() == null ? new JsonObject() : JsonParser.parseString(response.body().string()).getAsJsonObject();
            String status = result.has("status") ? result.get("status").getAsString() : "";
            switch (status) {
                case "approved" -> apply(result.get("subscription").getAsString(), current);
                case "pending" -> pending();
                default -> running = false;
            }
        } catch (Exception e) {
            e.printStackTrace();
            retry();
        }
    }

    private static String body() {
        JsonObject object = new JsonObject();
        object.addProperty("deviceId", DeviceId.get());
        object.addProperty("name", AirPlay.getName());
        object.addProperty("model", Build.MANUFACTURER + " " + Build.MODEL);
        object.addProperty("mode", BuildConfig.FLAVOR_mode);
        object.addProperty("abi", BuildConfig.FLAVOR_abi);
        object.addProperty("versionCode", BuildConfig.VERSION_CODE);
        object.addProperty("versionName", BuildConfig.VERSION_NAME);
        return object.toString();
    }

    private static void apply(String subscription, String current) {
        running = false;
        if (TextUtils.isEmpty(subscription)) return;
        Prefers.put(KEY_SUBSCRIPTION, subscription);
        if (subscription.equals(current)) return;
        App.post(() -> {
            Notify.show(R.string.enroll_approved);
            ServerEvent.config(Config.find(subscription, 0));
        });
    }

    private static void pending() {
        if (!notified) {
            notified = true;
            App.post(() -> Notify.show(ResUtil.getString(R.string.enroll_pending, AirPlay.getName())));
        }
        retry();
    }

    private static void retry() {
        Task.schedule(Enroll::check, POLL_SECONDS, TimeUnit.SECONDS);
    }
}
