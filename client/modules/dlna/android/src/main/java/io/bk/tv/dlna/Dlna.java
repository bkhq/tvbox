package io.bk.tv.dlna;

import android.Manifest;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;

import java.util.HashMap;
import java.util.Map;

/**
 * DLNA MediaRenderer entry point: starts {@link DlnaRendererService} on Android TV and relays
 * transport commands to JS through {@link CastListener}.
 */
public class Dlna {

    /** Receives cast events shaped like the JS {@code DlnaCastEvent}; called on UPnP threads. */
    public interface CastListener {

        void onCast(Map<String, Object> event);
    }

    private volatile CastListener listener;
    private volatile AvTransport avTransport;

    private static class Loader {
        static volatile Dlna INSTANCE = new Dlna();
    }

    public static Dlna get() {
        return Loader.INSTANCE;
    }

    /** Android TV only: leanback feature or television UI mode. */
    public static boolean isTv(Context context) {
        if (context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true;
        UiModeManager manager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        return manager != null && manager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    /** Same rule as the Java app's Util.getDeviceName(). */
    public static String getDeviceName() {
        String model = Build.MODEL;
        String manufacturer = Build.MANUFACTURER;
        return model.startsWith(manufacturer) ? model : manufacturer + " " + model;
    }

    public void setListener(CastListener listener) {
        this.listener = listener;
    }

    /** Permissions the UPnP stack needs; a missing one throws inside the service and kills the process. */
    private static final String[] PERMISSIONS = {
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_WIFI_STATE,
            Manifest.permission.ACCESS_NETWORK_STATE,
            Manifest.permission.CHANGE_WIFI_MULTICAST_STATE,
            Manifest.permission.WAKE_LOCK,
    };

    /** Starts the renderer, or renames it when it already runs. An empty name uses the device name. No-op off TV. */
    public void start(Context context, String name) {
        if (!isTv(context)) return;
        for (String permission : PERMISSIONS) {
            if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                throw new IllegalStateException("DLNA needs " + permission);
            }
        }
        String friendlyName = name == null || name.trim().isEmpty() ? getDeviceName() : name.trim();
        context.startService(new Intent(context, DlnaRendererService.class).putExtra(DlnaRendererService.EXTRA_NAME, friendlyName));
    }

    public void stop(Context context) {
        context.stopService(new Intent(context, DlnaRendererService.class));
    }

    /** Player state reported by JS. Milliseconds. */
    public void updatePlayback(double position, double duration, boolean playing, boolean ended) {
        AvTransport current = avTransport;
        if (current != null) current.updatePlayback((long) position, (long) duration, playing, ended);
    }

    void attach(AvTransport avTransport) {
        this.avTransport = avTransport;
    }

    void detach(AvTransport avTransport) {
        if (this.avTransport == avTransport) this.avTransport = null;
    }

    void emit(String type) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", type);
        send(event);
    }

    void emitPlay(String url, String title, Map<String, String> headers) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "play");
        event.put("url", url);
        if (title != null && !title.isEmpty()) event.put("title", title);
        if (!headers.isEmpty()) {
            Bundle bundle = new Bundle();
            headers.forEach(bundle::putString);
            event.put("headers", bundle);
        }
        send(event);
    }

    void emitSeek(long positionMs) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "seek");
        event.put("position", (double) positionMs);
        send(event);
    }

    void emitVolume(int volume) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "volume");
        event.put("volume", (double) volume);
        send(event);
    }

    void emitMute(boolean mute) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "mute");
        event.put("mute", mute);
        send(event);
    }

    private void send(Map<String, Object> event) {
        CastListener current = listener;
        if (current != null) current.onCast(event);
    }
}
