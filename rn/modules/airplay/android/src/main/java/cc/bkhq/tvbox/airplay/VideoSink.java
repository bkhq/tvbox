package cc.bkhq.tvbox.airplay;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.Arrays;

/**
 * Decodes the mirrored Annex-B H.264 stream straight to a Surface. Frames that arrive before a
 * surface is attached are queued from the latest SPS/PPS so the decoder can start on a key frame.
 */
class VideoSink {

    interface Listener {

        void onVideoSize(int width, int height);
    }

    private static final String MIME = MediaFormat.MIMETYPE_VIDEO_AVC;
    private static final int MAX_PENDING = 300;
    private static final long INPUT_TIMEOUT_US = 10_000;

    private final ArrayDeque<byte[]> pending = new ArrayDeque<>();
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

    private Listener listener;
    private MediaCodec codec;
    private Surface surface;
    private byte[] config;

    synchronized void setListener(Listener listener) {
        this.listener = listener;
    }

    synchronized void attach(Surface surface) {
        this.surface = surface;
        if (config == null) return;
        start();
        while (!pending.isEmpty() && codec != null) queue(pending.poll(), 0);
    }

    synchronized void detach() {
        release();
        surface = null;
        pending.clear();
    }

    synchronized void reset() {
        release();
        pending.clear();
        config = null;
    }

    synchronized void onData(byte[] data) {
        if (isConfig(data)) {
            if (Arrays.equals(data, config)) return;
            config = data;
            pending.clear();
            if (surface != null) start();
            return;
        }
        if (config == null) return;
        if (codec == null) {
            if (pending.size() >= MAX_PENDING) pending.clear();
            pending.add(data);
            return;
        }
        queue(data, 0);
    }

    private void start() {
        release();
        try {
            MediaFormat format = MediaFormat.createVideoFormat(MIME, 1920, 1080);
            byte[][] parts = split(config);
            if (parts.length >= 2) {
                format.setByteBuffer("csd-0", ByteBuffer.wrap(parts[0]));
                format.setByteBuffer("csd-1", ByteBuffer.wrap(parts[1]));
            }
            format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 1920 * 1080);
            codec = MediaCodec.createDecoderByType(MIME);
            codec.configure(format, surface, null, 0);
            codec.start();
            if (parts.length < 2) queue(config, MediaCodec.BUFFER_FLAG_CODEC_CONFIG);
        } catch (Exception e) {
            e.printStackTrace();
            release();
        }
    }

    private void queue(byte[] data, int flags) {
        try {
            int index = codec.dequeueInputBuffer(INPUT_TIMEOUT_US);
            if (index >= 0) {
                ByteBuffer buffer = codec.getInputBuffer(index);
                if (buffer != null && data.length <= buffer.capacity()) {
                    buffer.clear();
                    buffer.put(data);
                    codec.queueInputBuffer(index, 0, data.length, System.nanoTime() / 1000, flags);
                } else {
                    codec.queueInputBuffer(index, 0, 0, 0, 0);
                }
            }
            drain();
        } catch (Exception e) {
            e.printStackTrace();
            release();
        }
    }

    private void drain() {
        while (true) {
            int index = codec.dequeueOutputBuffer(info, 0);
            if (index >= 0) {
                codec.releaseOutputBuffer(index, true);
            } else if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                notifySize(codec.getOutputFormat());
            } else {
                return;
            }
        }
    }

    private void notifySize(MediaFormat format) {
        int width = format.getInteger(MediaFormat.KEY_WIDTH);
        int height = format.getInteger(MediaFormat.KEY_HEIGHT);
        if (format.containsKey("crop-right") && format.containsKey("crop-left")) width = format.getInteger("crop-right") - format.getInteger("crop-left") + 1;
        if (format.containsKey("crop-bottom") && format.containsKey("crop-top")) height = format.getInteger("crop-bottom") - format.getInteger("crop-top") + 1;
        if (listener != null) listener.onVideoSize(width, height);
    }

    private void release() {
        if (codec == null) return;
        try {
            codec.stop();
        } catch (Exception ignored) {
        }
        codec.release();
        codec = null;
    }

    /** SPS (NAL type 7) starts the parameter-set packet the server sends separately. */
    private static boolean isConfig(byte[] data) {
        return data.length > 4 && data[0] == 0 && data[1] == 0 && data[2] == 0 && data[3] == 1 && (data[4] & 0x1f) == 7;
    }

    private static byte[][] split(byte[] data) {
        java.util.List<byte[]> parts = new java.util.ArrayList<>();
        int start = 0;
        for (int i = 4; i + 3 < data.length; i++) {
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1) {
                parts.add(Arrays.copyOfRange(data, start, i));
                start = i;
            }
        }
        parts.add(Arrays.copyOfRange(data, start, data.length));
        return parts.toArray(new byte[0][]);
    }
}
