package io.bk.tv.airplay;

import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;

import com.github.serezhka.airplay.protocol.media.AudioStreamInfo;
import com.github.serezhka.airplay.protocol.media.VideoStreamInfo;
import com.github.serezhka.airplay.server.AirPlayConfig;
import com.github.serezhka.airplay.server.AirPlayServer;
import com.github.serezhka.airplay.server.Playback;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AirPlay receiver: advertises the TV over mDNS, renders screen mirroring with MediaCodec and
 * hands HLS video casts (YouTube, Safari, ...) to the JS player through {@link CastListener}.
 */
public class AirPlay implements Playback {

    /** Receives HLS cast commands; called on the main thread. */
    public interface CastListener {

        void onPlay(String url, long positionMs);

        void onPause();

        void onResume();

        void onStop();

        void onSeek(long positionMs);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final VideoSink video;
    private final AudioSink audio;

    private WifiManager.MulticastLock lock;
    private AirPlayServer server;
    private Context context;
    private String name;
    private Runnable onMirrorEnd;

    private volatile CastListener listener;
    private volatile boolean casting;
    private volatile Info info = Info.idle();

    private static class Loader {
        static volatile AirPlay INSTANCE = new AirPlay();
    }

    public static AirPlay get() {
        return Loader.INSTANCE;
    }

    private AirPlay() {
        video = new VideoSink();
        audio = new AudioSink();
    }

    /** Android TV only: leanback feature or television UI mode. */
    public static boolean isTv(Context context) {
        if (context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true;
        UiModeManager manager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        return manager != null && manager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    public void setListener(CastListener listener) {
        this.listener = listener;
    }

    /** Starts the receiver, or restarts it when it already runs under another name. No-op off TV. */
    public synchronized void start(Context context, String name) {
        if (!isTv(context)) return;
        if (server != null && name.equals(this.name)) return;
        stop();
        this.context = context.getApplicationContext();
        this.name = name;
        acquireLock();
        AirPlayServer created = new AirPlayServer(config(), this);
        server = created;
        executor.execute(() -> {
            try {
                created.start();
            } catch (Exception e) {
                e.printStackTrace();
                synchronized (this) {
                    if (server == created) stop();
                }
            }
        });
    }

    public synchronized void stop() {
        AirPlayServer current = server;
        server = null;
        if (current != null) executor.execute(current::stop);
        video.reset();
        audio.release();
        releaseLock();
        casting = false;
        info = Info.idle();
    }

    /** Player state reported by JS, served to the sender as {@code /playback-info}. */
    public void updatePlayback(double positionMs, double durationMs, boolean playing, double rate) {
        info = new Info(Math.max(0, durationMs) / 1000.0, Math.max(0, positionMs) / 1000.0, playing ? rate : 0);
    }

    private AirPlayConfig config() {
        AirPlayConfig config = new AirPlayConfig();
        config.setServerName(name);
        config.setDeviceId(DeviceId.get(context));
        config.setWidth(1920);
        config.setHeight(1080);
        config.setFps(30);
        return config;
    }

    private void acquireLock() {
        WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return;
        try {
            lock = wifi.createMulticastLock("airplay");
            lock.setReferenceCounted(false);
            lock.acquire();
        } catch (SecurityException e) {
            // Best effort: mDNS still works on most devices without the lock.
            e.printStackTrace();
            lock = null;
        }
    }

    private void releaseLock() {
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
    }

    // ── mirror view ──

    void attach(android.view.Surface surface, VideoSink.Listener listener, Runnable onEnd) {
        onMirrorEnd = onEnd;
        video.setListener(listener);
        video.attach(surface);
    }

    void detach() {
        onMirrorEnd = null;
        video.setListener(null);
        video.detach();
    }

    // ── Playback: screen mirroring ──

    @Override
    public void onVideoFormat(VideoStreamInfo videoStreamInfo) {
        Context current = context;
        if (current == null) return;
        MAIN.post(() -> current.startActivity(new Intent(current, MirrorActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
    }

    @Override
    public void onVideo(byte[] bytes) {
        video.onData(bytes);
    }

    @Override
    public void onVideoSrcDisconnect() {
        video.reset();
        Runnable end = onMirrorEnd;
        if (end != null) MAIN.post(end);
    }

    @Override
    public void onAudioFormat(AudioStreamInfo audioStreamInfo) {
        audio.start(audioStreamInfo);
    }

    @Override
    public void onAudio(byte[] bytes) {
        audio.onData(bytes);
    }

    @Override
    public void onAudioSrcDisconnect() {
        audio.release();
    }

    @Override
    public void onVolume(double volumeLinear) {
        audio.setVolume((float) volumeLinear);
    }

    // ── Playback: HLS casts go to the JS player ──

    @Override
    public void onPlaylist(String playlistUri) {
        casting = true;
        info = Info.idle();
        dispatch(listener -> listener.onPlay(playlistUri, 0));
    }

    @Override
    public void onPlaylistRemoved() {
        casting = false;
        info = Info.idle();
        dispatch(CastListener::onStop);
    }

    @Override
    public void onPause() {
        dispatch(CastListener::onPause);
    }

    @Override
    public void onResume() {
        dispatch(CastListener::onResume);
    }

    @Override
    public void onSeek(double positionSeconds) {
        dispatch(listener -> listener.onSeek((long) (positionSeconds * 1000)));
    }

    @Override
    public Info info() {
        return casting ? info : Info.idle();
    }

    private void dispatch(java.util.function.Consumer<CastListener> action) {
        MAIN.post(() -> {
            CastListener current = listener;
            if (current != null) action.accept(current);
        });
    }
}
