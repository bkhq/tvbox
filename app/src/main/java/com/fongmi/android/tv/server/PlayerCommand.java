package com.fongmi.android.tv.server;

import com.fongmi.android.tv.service.PlaybackService;
import com.fongmi.android.tv.setting.SpeedSetting;

import java.util.function.Consumer;

/**
 * Playback commands sent over the local server, shared by {@code /api/control} and the legacy
 * {@code /action?do=control}. Values are parsed here, before the command is posted to the main
 * thread, so a bad request cannot throw on it.
 */
public final class PlayerCommand {

    private PlayerCommand() {
    }

    /**
     * @return null when the command is unknown
     * @throws IllegalArgumentException when the value does not fit the command
     */
    public static Consumer<PlaybackService> of(String type, String value) {
        return switch (type) {
            case "play" -> service -> service.player().play();
            case "pause" -> service -> service.player().pause();
            case "toggle" -> service -> {
                if (service.player().isPlaying()) service.player().pause();
                else service.player().play();
            };
            case "stop" -> PlaybackService::dispatchStop;
            case "prev" -> PlaybackService::dispatchPrev;
            case "next" -> PlaybackService::dispatchNext;
            case "repeat" -> PlaybackService::dispatchRepeat;
            case "replay" -> PlaybackService::dispatchReplay;
            case "seek" -> {
                long offset = parseLong(value);
                yield service -> service.player().seekTo(Math.max(0, service.player().getPosition() + offset));
            }
            case "seekto" -> {
                long position = Math.max(0, parseLong(value));
                yield service -> service.player().seekTo(position);
            }
            case "speed" -> {
                float speed = parseSpeed(value);
                yield service -> service.player().setSpeed(speed);
            }
            default -> null;
        };
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Invalid value");
        }
    }

    private static float parseSpeed(String value) {
        try {
            float speed = Float.parseFloat(value);
            if (speed >= SpeedSetting.MIN && speed <= SpeedSetting.MAX) return speed;
        } catch (NumberFormatException ignored) {
        }
        throw new IllegalArgumentException("Invalid value");
    }
}
