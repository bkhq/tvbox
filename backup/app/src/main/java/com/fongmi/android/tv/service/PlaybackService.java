package com.fongmi.android.tv.service;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaLibraryService.MediaLibrarySession;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import androidx.media3.ui.danmaku.DanmakuConfig;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.BuildConfig;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.event.ActionEvent;
import com.fongmi.android.tv.player.PlayerManager;
import com.fongmi.android.tv.server.Server;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;


import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

public class PlaybackService extends MediaLibraryService implements MediaLibrarySession.Callback, PlayerManager.Callback {

    public static final String LOCAL_BIND_ACTION = BuildConfig.APPLICATION_ID.concat(".LOCAL_BIND");

    private static final SessionCommand COMMAND_REPEAT = new SessionCommand(ActionEvent.REPEAT, Bundle.EMPTY);

    private static volatile boolean running;

    private final List<PlayerCallback> playerCallbacks = new CopyOnWriteArrayList<>();
    private final MediaClients clients = new MediaClients();
    private final IBinder binder = new LocalBinder();

    private NavigationCallback navigationCallback;
    private MediaLibrarySession session;
    private ActivityBinding binding;
    private PlayerManager player;
    private String navigationKey;
    private Player sessionPlayer;

    public static boolean isRunning() {
        return running;
    }

    public void claimBinding(NavigationCallback owner, Runnable onReplaced) {
        if (ownsBinding(owner)) return;
        if (binding != null) binding.onReplaced().run();
        binding = new ActivityBinding(owner, onReplaced);
    }

    public boolean ownsBinding(NavigationCallback owner) {
        return binding != null && binding.owner() == owner;
    }

    public boolean releaseBinding(NavigationCallback owner) {
        if (navigationCallback == owner) setNavigationCallback(null, null);
        if (!ownsBinding(owner)) return false;
        binding = null;
        return true;
    }

    public PlayerManager player() {
        return player;
    }

    private boolean hasNavigationCallback() {
        return navigationCallback != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        player = new PlayerManager(this);
        sessionPlayer = player.getPlayer();
        sessionPlayer.addListener(listener);
        session = new MediaLibrarySession.Builder(this, wrap(sessionPlayer), this).build();
        session.setSessionActivity(buildDefaultIntent());
        Server.get().setService(this);
        setupNotification();
    }

    private PendingIntent buildDefaultIntent() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (intent == null) intent = new Intent();
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void setupNotification() {
        DefaultMediaNotificationProvider provider = new DefaultMediaNotificationProvider.Builder(this).build();
        session.setMediaButtonPreferences(ImmutableList.of(buildRepeatButton(), buildStopButton()));
        provider.setSmallIcon(R.drawable.ic_notification);
        setMediaNotificationProvider(provider);
    }

    private CommandButton buildStopButton() {
        return new CommandButton.Builder(CommandButton.ICON_STOP).setPlayerCommand(Player.COMMAND_STOP).setDisplayName(getString(R.string.play_stop)).build();
    }

    private CommandButton buildRepeatButton() {
        return new CommandButton.Builder(player.isRepeatOne() ? CommandButton.ICON_REPEAT_ONE : CommandButton.ICON_REPEAT_OFF).setSessionCommand(COMMAND_REPEAT).setDisplayName(getString(R.string.play_repeat)).build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) handleAction(intent.getAction());
        return super.onStartCommand(intent, flags, startId);
    }

    private void handleAction(String action) {
        if (ActionEvent.PLAY.equals(action)) player.play();
        else if (ActionEvent.PAUSE.equals(action)) player.pause();
        else if (ActionEvent.PREV.equals(action)) dispatchPrev();
        else if (ActionEvent.NEXT.equals(action)) dispatchNext();
        else if (ActionEvent.STOP.equals(action)) dispatchStop();
        else if (ActionEvent.AUDIO.equals(action)) dispatchAudio();
        else if (ActionEvent.REPEAT.equals(action)) dispatchRepeat();
        else if (ActionEvent.REPLAY.equals(action)) dispatchReplay();
    }

    private boolean isLocalBind(Intent intent) {
        return LOCAL_BIND_ACTION.equals(intent != null ? intent.getAction() : null);
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (isLocalBind(intent)) return binder;
        return super.onBind(intent);
    }

    @Override
    public boolean onUnbind(Intent intent) {
        if (isLocalBind(intent)) tryShutdown();
        return super.onUnbind(intent);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        tryShutdown();
    }

    @Override
    public void onDisconnected(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller) {
        if (isAppController(controller)) return;
        releaseController(controller);
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseSession();
        player.release();
        removeForeground();
        Server.get().setService(null);
        super.onDestroy();
    }

    private void stopAndClear() {
        player.stop();
        player.clearPreload();
        player.clearMediaItems();
    }

    public void suspend() {
        stopAndClear();
        removeForeground();
    }

    public void shutdown() {
        if (!running) return;
        running = false;
        stopAndClear();
        stopSelf();
    }

    private void tryShutdown() {
        if (!hasNavigationCallback() && !hasMediaClient()) shutdown();
    }

    private void releaseController(@NonNull MediaSession.ControllerInfo controller) {
        clients.disconnect(controller);
        tryShutdown();
    }

    private void releaseSession() {
        if (session == null) return;
        session.release();
        session = null;
    }

    private void removeForeground() {
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @NonNull
    @Override
    public MediaSession.ConnectionResult onConnect(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller) {
        clients.connect(controller, getPackageName());
        SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon().add(COMMAND_REPEAT).build();
        return new MediaLibrarySession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build();
    }

    private boolean isAppController(@NonNull MediaSession.ControllerInfo controller) {
        return clients.isSelf(controller, getPackageName());
    }

    @NonNull
    @Override
    public ListenableFuture<SessionResult> onCustomCommand(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller, @NonNull SessionCommand customCommand, @NonNull Bundle args) {
        if (COMMAND_REPEAT.customAction.equals(customCommand.customAction)) {
            dispatchRepeat();
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }
        return MediaLibrarySession.Callback.super.onCustomCommand(session, controller, customCommand, args);
    }

    public boolean hasMediaClient() {
        return clients.hasAny();
    }

    public void setSessionActivity(PendingIntent pendingIntent) {
        if (session != null) session.setSessionActivity(pendingIntent);
    }

    public void resetSessionActivity() {
        setSessionActivity(buildDefaultIntent());
    }

    public void setNavigationCallback(NavigationCallback navigationCallback, String key) {
        this.navigationCallback = navigationCallback;
        this.navigationKey = key;
    }

    private boolean isNavigationOwner() {
        return navigationKey == null || navigationKey.equals(player.getKey());
    }

    public void addPlayerCallback(PlayerCallback callback) {
        playerCallbacks.add(callback);
    }

    public void removePlayerCallback(PlayerCallback callback) {
        playerCallbacks.remove(callback);
    }

    public boolean hasPlayerCallback() {
        return !playerCallbacks.isEmpty();
    }

    public void dispatchPrev() {
        dispatchNavigate(NavigationCallback::onPrev, -1);
    }

    public void dispatchNext() {
        dispatchNavigate(NavigationCallback::onNext, 1);
    }

    private void dispatchNavigate(Consumer<NavigationCallback> action, int delta) {
        if (hasNavigationCallback() && isNavigationOwner()) dispatch(action);
    }

    public void dispatchStop() {
        if (player.getPlaybackState() == Player.STATE_IDLE) return;
        if (hasNavigationCallback() && isNavigationOwner()) dispatch(NavigationCallback::onStop);
        else stopAndClear();
    }

    public void dispatchRepeat() {
        player.setRepeatOne(!player.isRepeatOne());
    }

    public void dispatchReplay() {
        if (hasNavigationCallback() && isNavigationOwner()) dispatch(NavigationCallback::onReplay);
        else {
            player.seekTo(0);
            player.play();
        }
    }

    public void dispatchAudio() {
        dispatch(NavigationCallback::onAudio);
    }

    private void dispatch(Consumer<NavigationCallback> action) {
        NavigationCallback callback = navigationCallback;
        if (callback != null) App.post(() -> action.accept(callback));
    }

    private ForwardingPlayer wrap(Player base) {
        return new ForwardingPlayer(base) {
            @Override
            public void seekToPrevious() {
                dispatchPrev();
            }

            @Override
            public void seekToPreviousMediaItem() {
                dispatchPrev();
            }

            @Override
            public void seekToNext() {
                dispatchNext();
            }

            @Override
            public void seekToNextMediaItem() {
                dispatchNext();
            }

            @Override
            public void stop() {
                dispatchStop();
            }

            @NonNull
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon().add(COMMAND_SEEK_TO_PREVIOUS).add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM).add(COMMAND_SEEK_TO_NEXT).add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).add(COMMAND_SEEK_BACK).add(COMMAND_SEEK_FORWARD).add(COMMAND_STOP).add(COMMAND_SET_REPEAT_MODE).build();
            }
        };
    }

    @Override
    public void onPrepare() {
        playerCallbacks.forEach(PlayerCallback::onPrepare);
    }

    @Override
    public void onTracksChanged() {
        playerCallbacks.forEach(PlayerCallback::onTracksChanged);
    }

    @Override
    public void onDecodeChanged() {
        playerCallbacks.forEach(PlayerCallback::onDecodeChanged);
    }

    @Override
    public void onMediaOptionsChanged() {
        playerCallbacks.forEach(PlayerCallback::onMediaOptionsChanged);
    }

    @Override
    public void onError(String msg) {
        playerCallbacks.forEach(callback -> callback.onError(msg));
    }

    @Override
    public void onPlayerRebuild(Player newPlayer) {
        sessionPlayer.removeListener(listener);
        sessionPlayer = newPlayer;
        sessionPlayer.addListener(listener);
        if (session != null) session.setPlayer(wrap(newPlayer));
        playerCallbacks.forEach(callback -> callback.onPlayerRebuild(newPlayer));
    }

    @Override
    public void onDanmakuSourceChanged(Uri uri) {
        playerCallbacks.forEach(callback -> callback.onDanmakuSourceChanged(uri));
    }

    @Override
    public void onDanmakuConfigChanged(DanmakuConfig config) {
        playerCallbacks.forEach(callback -> callback.onDanmakuConfigChanged(config));
    }

    @Override
    public void onDanmakuEnabledChanged(boolean enabled) {
        playerCallbacks.forEach(callback -> callback.onDanmakuEnabledChanged(enabled));
    }

    @Override
    public void onDanmakuSent(String text) {
        playerCallbacks.forEach(callback -> callback.onDanmakuSent(text));
    }

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onRepeatModeChanged(int repeatMode) {
            if (session != null) session.setMediaButtonPreferences(ImmutableList.of(buildRepeatButton(), buildStopButton()));
        }
    };

    public interface PlayerCallback {

        default void onPrepare() {
        }

        default void onTracksChanged() {
        }

        default void onDecodeChanged() {
        }

        default void onMediaOptionsChanged() {
        }

        default void onError(String msg) {
        }

        default void onPlayerRebuild(Player player) {
        }

        default void onDanmakuSourceChanged(Uri uri) {
        }

        default void onDanmakuConfigChanged(DanmakuConfig config) {
        }

        default void onDanmakuEnabledChanged(boolean enabled) {
        }

        default void onDanmakuSent(String text) {
        }
    }

    public interface NavigationCallback {

        default void onPrev() {
        }

        default void onNext() {
        }

        default void onStop() {
        }

        default void onReplay() {
        }

        default void onAudio() {
        }
    }

    private record ActivityBinding(NavigationCallback owner, Runnable onReplaced) {
    }

    public class LocalBinder extends Binder {

        public PlaybackService getService() {
            return PlaybackService.this;
        }
    }
}
