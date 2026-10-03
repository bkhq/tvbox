package com.fongmi.android.tv.airplay;

import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.text.TextUtils;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.event.ServerEvent;
import com.fongmi.android.tv.player.PlayerManager;
import com.fongmi.android.tv.server.Server;
import com.fongmi.android.tv.service.PlaybackService;
import com.fongmi.android.tv.setting.Setting;
import com.fongmi.android.tv.utils.DeviceId;
import com.fongmi.android.tv.utils.ResUtil;
import com.fongmi.android.tv.utils.Task;
import com.github.serezhka.airplay.protocol.media.AudioStreamInfo;
import com.github.serezhka.airplay.protocol.media.VideoStreamInfo;
import com.github.serezhka.airplay.server.AirPlayConfig;
import com.github.serezhka.airplay.server.AirPlayServer;
import com.github.serezhka.airplay.server.Playback;

import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/**
 * AirPlay receiver: advertises the TV over mDNS, renders screen mirroring with MediaCodec and
 * hands HLS video casts (YouTube, Safari, ...) to the regular player.
 */
public class AirPlay implements Playback {

    private final VideoSink video;
    private final AudioSink audio;

    private WifiManager.MulticastLock lock;
    private AirPlayServer server;
    private Runnable onMirrorEnd;

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

    public synchronized void start() {
        if (server != null || !Setting.isAirPlay()) return;
        acquireLock();
        AirPlayServer created = new AirPlayServer(config(), this);
        server = created;
        Task.execute(() -> {
            try {
                created.start();
            } catch (Exception e) {
                e.printStackTrace();
                stop();
            }
        });
    }

    public synchronized void stop() {
        AirPlayServer current = server;
        server = null;
        if (current != null) Task.execute(current::stop);
        video.reset();
        audio.release();
        releaseLock();
    }

    public void restart() {
        stop();
        start();
    }

    private AirPlayConfig config() {
        AirPlayConfig config = new AirPlayConfig();
        config.setServerName(getName());
        config.setDeviceId(DeviceId.get());
        config.setWidth(1920);
        config.setHeight(1080);
        config.setFps(30);
        return config;
    }

    public static String getName() {
        String name = Setting.getAirPlayName();
        return TextUtils.isEmpty(name) ? ResUtil.getString(R.string.app_name) : name;
    }

    private void acquireLock() {
        WifiManager wifi = (WifiManager) App.get().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return;
        lock = wifi.createMulticastLock("airplay");
        lock.setReferenceCounted(false);
        lock.acquire();
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
        App.post(() -> {
            Context context = App.get();
            context.startActivity(new Intent(context, MirrorActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        });
    }

    @Override
    public void onVideo(byte[] bytes) {
        video.onData(bytes);
    }

    @Override
    public void onVideoSrcDisconnect() {
        video.reset();
        Runnable end = onMirrorEnd;
        if (end != null) App.post(end);
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

    // ── Playback: HLS casts go to the regular player ──

    @Override
    public void onPlaylist(String playlistUri) {
        App.post(() -> ServerEvent.push(playlistUri));
    }

    @Override
    public void onPlaylistRemoved() {
        withService(PlaybackService::dispatchStop);
    }

    @Override
    public void onPause() {
        withService(service -> service.player().pause());
    }

    @Override
    public void onResume() {
        withService(service -> service.player().play());
    }

    @Override
    public void onSeek(double positionSeconds) {
        withService(service -> service.player().seekTo((long) (positionSeconds * 1000)));
    }

    @Override
    public Info info() {
        return onMain(() -> {
            PlaybackService service = Server.get().getService();
            PlayerManager player = service == null ? null : service.player();
            if (player == null || TextUtils.isEmpty(player.getUrl())) return Info.idle();
            return new Info(Math.max(0, player.getDuration()) / 1000.0, Math.max(0, player.getPosition()) / 1000.0, player.isPlaying() ? 1 : 0);
        }, Info.idle());
    }

    private static void withService(java.util.function.Consumer<PlaybackService> action) {
        App.post(() -> {
            PlaybackService service = Server.get().getService();
            if (service != null) action.accept(service);
        });
    }

    private static <T> T onMain(Callable<T> callable, T fallback) {
        FutureTask<T> task = new FutureTask<>(callable);
        App.post(task);
        try {
            return task.get(1, TimeUnit.SECONDS);
        } catch (Exception e) {
            return fallback;
        }
    }
}
