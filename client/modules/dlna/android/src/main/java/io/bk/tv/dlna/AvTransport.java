package io.bk.tv.dlna;

import org.json.JSONObject;
import org.jupnp.model.types.UnsignedIntegerFourBytes;
import org.jupnp.support.avtransport.AbstractAVTransportService;
import org.jupnp.support.avtransport.lastchange.AVTransportVariable;
import org.jupnp.support.contentdirectory.DIDLParser;
import org.jupnp.support.model.DIDLContent;
import org.jupnp.support.model.DIDLObject;
import org.jupnp.support.model.DeviceCapabilities;
import org.jupnp.support.model.MediaInfo;
import org.jupnp.support.model.PlayMode;
import org.jupnp.support.model.PositionInfo;
import org.jupnp.support.model.RecordQualityMode;
import org.jupnp.support.model.SeekMode;
import org.jupnp.support.model.StorageMedium;
import org.jupnp.support.model.TransportAction;
import org.jupnp.support.model.TransportInfo;
import org.jupnp.support.model.TransportSettings;
import org.jupnp.support.model.TransportState;
import org.jupnp.support.model.TransportStatus;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * AVTransport of the renderer. Transport commands go to JS through {@link Dlna}; the player
 * state JS reports with {@link #updatePlayback} answers GetPositionInfo / GetTransportInfo and
 * drives the LastChange events.
 */
public class AvTransport extends AbstractAVTransportService {

    private volatile PlayMode currentPlayMode = PlayMode.NORMAL;
    private volatile TransportState currentState = TransportState.NO_MEDIA_PRESENT;

    private volatile String nextURI = "";
    private volatile String currentURI = "";
    private volatile String nextMetaData = "";
    private volatile String currentMetaData = "";

    private volatile long cachedPosition = -1;
    private volatile long cachedDuration = -1;

    @Override
    public UnsignedIntegerFourBytes[] getCurrentInstanceIds() {
        return new UnsignedIntegerFourBytes[]{getDefaultInstanceID()};
    }

    @Override
    public synchronized void setAVTransportURI(UnsignedIntegerFourBytes instanceId, String currentURI, String currentURIMetaData) {
        this.nextURI = "";
        this.nextMetaData = "";
        this.currentURI = currentURI != null ? currentURI : "";
        this.currentMetaData = currentURIMetaData != null ? currentURIMetaData : "";
        cast();
    }

    @Override
    public synchronized void setNextAVTransportURI(UnsignedIntegerFourBytes instanceId, String nextURI, String nextURIMetaData) {
        this.nextURI = nextURI != null ? nextURI : "";
        this.nextMetaData = nextURIMetaData != null ? nextURIMetaData : "";
    }

    @Override
    public MediaInfo getMediaInfo(UnsignedIntegerFourBytes instanceId) {
        String nURI = nextURI.isEmpty() ? "" : nextURI;
        String nMeta = nextURI.isEmpty() ? "" : nextMetaData;
        String durStr = cachedDuration > 0 ? formatMs(cachedDuration) : "00:00:00";
        return new MediaInfo(currentURI, currentMetaData, nURI, nMeta, new UnsignedIntegerFourBytes(1), durStr, StorageMedium.NETWORK);
    }

    @Override
    public TransportInfo getTransportInfo(UnsignedIntegerFourBytes instanceId) {
        return new TransportInfo(currentState, TransportStatus.OK, "1");
    }

    @Override
    public PositionInfo getPositionInfo(UnsignedIntegerFourBytes instanceId) {
        long posMs = cachedPosition;
        long durMs = cachedDuration;
        if (posMs < 0) return new PositionInfo(1, currentMetaData, currentURI);
        String relTime = formatMs(posMs);
        String durStr = durMs > 0 ? formatMs(durMs) : "00:00:00";
        return new PositionInfo(1, durStr, currentMetaData, currentURI, relTime, relTime, Integer.MAX_VALUE, Integer.MAX_VALUE);
    }

    @Override
    public DeviceCapabilities getDeviceCapabilities(UnsignedIntegerFourBytes instanceId) {
        return new DeviceCapabilities(new StorageMedium[]{StorageMedium.NETWORK});
    }

    @Override
    public TransportSettings getTransportSettings(UnsignedIntegerFourBytes instanceId) {
        return new TransportSettings(currentPlayMode, RecordQualityMode.NOT_IMPLEMENTED);
    }

    @Override
    public void stop(UnsignedIntegerFourBytes instanceId) {
        if (currentURI.isEmpty()) return;
        fireStateChange(TransportState.STOPPED);
        Dlna.get().emit("stop");
    }

    @Override
    public synchronized void play(UnsignedIntegerFourBytes instanceId, String speed) {
        if (currentURI.isEmpty()) return;
        // After Stop or the end of the media the player has nothing to resume: cast again.
        if (currentState == TransportState.STOPPED || currentState == TransportState.NO_MEDIA_PRESENT) cast();
        else Dlna.get().emit("resume");
    }

    @Override
    public void pause(UnsignedIntegerFourBytes instanceId) {
        if (currentURI.isEmpty()) return;
        fireStateChange(TransportState.PAUSED_PLAYBACK);
        Dlna.get().emit("pause");
    }

    @Override
    public void record(UnsignedIntegerFourBytes instanceId) {
        throw new UnsupportedOperationException("Recording not supported");
    }

    @Override
    public void seek(UnsignedIntegerFourBytes instanceId, String unit, String target) {
        if (currentURI.isEmpty()) return;
        if (!SeekMode.REL_TIME.toString().equals(unit) && !SeekMode.ABS_TIME.toString().equals(unit)) return;
        Dlna.get().emitSeek(parseTimeToMs(target));
    }

    @Override
    public synchronized void next(UnsignedIntegerFourBytes instanceId) {
        if (canNext()) playNext();
    }

    @Override
    public void previous(UnsignedIntegerFourBytes instanceId) {
        if (!currentURI.isEmpty()) Dlna.get().emitSeek(0);
    }

    @Override
    public void setPlayMode(UnsignedIntegerFourBytes instanceId, String newPlayMode) {
        currentPlayMode = PlayMode.REPEAT_ONE.name().equals(newPlayMode) ? PlayMode.REPEAT_ONE : PlayMode.NORMAL;
    }

    @Override
    public void setRecordQualityMode(UnsignedIntegerFourBytes instanceId, String newRecordQualityMode) {
        throw new UnsupportedOperationException("Recording not supported");
    }

    @Override
    protected TransportAction[] getCurrentTransportActions(UnsignedIntegerFourBytes instanceId) {
        return switch (currentState) {
            case PLAYING -> withNext(TransportAction.Pause, TransportAction.Stop, TransportAction.Seek);
            case PAUSED_PLAYBACK -> withNext(TransportAction.Play, TransportAction.Stop, TransportAction.Seek);
            default -> withNext(TransportAction.Play);
        };
    }

    /** Player state from JS; ignored while nothing is cast. */
    public synchronized void updatePlayback(long position, long duration, boolean playing, boolean ended) {
        if (currentState == TransportState.STOPPED || currentState == TransportState.NO_MEDIA_PRESENT) return;
        cachedPosition = Math.max(0, position);
        cachedDuration = duration > 0 ? duration : -1;
        if (ended) {
            if (hasNext()) playNext();
            else fireStateChange(TransportState.STOPPED);
        } else if (playing) {
            fireStateChange(TransportState.PLAYING);
        } else if (currentState != TransportState.TRANSITIONING) {
            fireStateChange(TransportState.PAUSED_PLAYBACK);
        }
    }

    /** Renderer stopped: forget the cast. */
    public synchronized void reset() {
        nextURI = "";
        currentURI = "";
        nextMetaData = "";
        currentMetaData = "";
        currentPlayMode = PlayMode.NORMAL;
        fireStateChange(TransportState.NO_MEDIA_PRESENT);
    }

    private void cast() {
        cachedPosition = -1;
        cachedDuration = -1;
        fireStateChange(TransportState.TRANSITIONING);
        Dlna.get().emitPlay(currentURI, parseTitle(currentMetaData), parseHeaders(currentMetaData));
    }

    private void playNext() {
        currentURI = nextURI;
        currentMetaData = nextMetaData;
        nextURI = "";
        nextMetaData = "";
        cast();
    }

    private boolean hasNext() {
        return !nextURI.isEmpty();
    }

    private boolean canNext() {
        return !currentURI.isEmpty() && hasNext();
    }

    private TransportAction[] withNext(TransportAction... actions) {
        if (!canNext()) return actions;
        TransportAction[] result = Arrays.copyOf(actions, actions.length + 1);
        result[actions.length] = TransportAction.Next;
        return result;
    }

    private void fireStateChange(TransportState state) {
        if (currentState == state) return;
        currentState = state;
        try {
            getLastChange().setEventedValue(AbstractAVTransportService.getDefaultInstanceID(), new AVTransportVariable.TransportState(state));
            getLastChange().fire(propertyChangeSupport);
        } catch (Exception ignored) {
        }
    }

    private static String parseTitle(String metaData) {
        try {
            return new DIDLParser().parse(metaData).getItems().get(0).getTitle();
        } catch (Exception ignored) {
            return null;
        }
    }

    /** Request headers some senders put as a JSON object into dc:description. */
    private static Map<String, String> parseHeaders(String metaData) {
        Map<String, String> headers = new HashMap<>();
        try {
            DIDLContent content = new DIDLParser().parse(metaData);
            for (DIDLObject item : content.getItems()) {
                for (Object property : item.getProperties()) {
                    if (!(property instanceof DIDLObject.Property.DC.DESCRIPTION description)) continue;
                    JSONObject json = new JSONObject(String.valueOf(description.getValue()));
                    for (Iterator<String> keys = json.keys(); keys.hasNext(); ) {
                        String key = keys.next();
                        headers.put(key, json.optString(key));
                    }
                    return headers;
                }
            }
        } catch (Exception ignored) {
            headers.clear();
        }
        return headers;
    }

    private static long parseTimeToMs(String time) {
        try {
            String[] parts = time.split(":");
            if (parts.length != 3) return 0;
            int dot = parts[2].indexOf('.');
            long secs = Long.parseLong(dot >= 0 ? parts[2].substring(0, dot) : parts[2]);
            long frac = dot >= 0 ? Math.round(Double.parseDouble("0" + parts[2].substring(dot)) * 1000) : 0;
            return (Long.parseLong(parts[0]) * 3600 + Long.parseLong(parts[1]) * 60 + secs) * 1000 + frac;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static String formatMs(long ms) {
        if (ms <= 0) return "00:00:00";
        long s = ms / 1000;
        return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }
}
