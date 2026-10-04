package cc.bkhq.tvbox.airplay;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaFormat;

import com.github.serezhka.airplay.protocol.media.AudioStreamInfo;

import java.nio.ByteBuffer;

/** Decodes AirPlay AAC / AAC-ELD frames with MediaCodec and plays them through an AudioTrack. */
class AudioSink {

    private static final int SAMPLE_RATE = 44100;
    private static final int CHANNELS = 2;
    private static final long INPUT_TIMEOUT_US = 5_000;
    /** AudioSpecificConfig for AAC-ELD 44.1 kHz stereo, 480 samples per frame (screen mirroring). */
    private static final byte[] ASC_AAC_ELD = {(byte) 0xF8, (byte) 0xE8, 0x50, 0x00};
    /** AudioSpecificConfig for AAC-LC 44.1 kHz stereo. */
    private static final byte[] ASC_AAC_LC = {0x12, 0x10};

    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

    private MediaCodec codec;
    private AudioTrack track;
    private float volume = 1f;

    synchronized void start(AudioStreamInfo stream) {
        release();
        byte[] asc = switch (stream.getCompressionType()) {
            case AAC_ELD -> ASC_AAC_ELD;
            case AAC -> ASC_AAC_LC;
            default -> null;
        };
        if (asc == null) return;
        try {
            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, CHANNELS);
            format.setByteBuffer("csd-0", ByteBuffer.wrap(asc));
            codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            codec.configure(format, null, null, 0);
            codec.start();
            int size = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT) * 4;
            track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(size)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();
            track.setVolume(volume);
            track.play();
        } catch (Exception e) {
            e.printStackTrace();
            release();
        }
    }

    synchronized void onData(byte[] data) {
        if (codec == null) return;
        try {
            int index = codec.dequeueInputBuffer(INPUT_TIMEOUT_US);
            if (index >= 0) {
                ByteBuffer buffer = codec.getInputBuffer(index);
                if (buffer != null && data.length <= buffer.capacity()) {
                    buffer.clear();
                    buffer.put(data);
                    codec.queueInputBuffer(index, 0, data.length, System.nanoTime() / 1000, 0);
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

    synchronized void setVolume(float volume) {
        this.volume = volume;
        if (track != null) track.setVolume(volume);
    }

    synchronized void release() {
        if (codec != null) {
            try {
                codec.stop();
            } catch (Exception ignored) {
            }
            codec.release();
            codec = null;
        }
        if (track != null) {
            try {
                track.stop();
            } catch (Exception ignored) {
            }
            track.release();
            track = null;
        }
    }

    private void drain() {
        while (true) {
            int index = codec.dequeueOutputBuffer(info, 0);
            if (index < 0) return;
            ByteBuffer output = codec.getOutputBuffer(index);
            if (output != null && info.size > 0 && track != null) {
                output.position(info.offset).limit(info.offset + info.size);
                track.write(output, info.size, AudioTrack.WRITE_NON_BLOCKING);
            }
            codec.releaseOutputBuffer(index, false);
        }
    }
}
