package com.fongmi.android.tv.server.api;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.widget.EditText;

import com.fongmi.android.tv.App;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

/**
 * The phone as a remote: D-pad keys and text go to the app's foreground screen, volume to the
 * media stream. Keys only reach this app's own screens, not the launcher or other apps.
 */
public class RemoteApi implements Endpoint {

    private static final Map<String, Integer> KEYS = Map.of(
            "up", KeyEvent.KEYCODE_DPAD_UP,
            "down", KeyEvent.KEYCODE_DPAD_DOWN,
            "left", KeyEvent.KEYCODE_DPAD_LEFT,
            "right", KeyEvent.KEYCODE_DPAD_RIGHT,
            "ok", KeyEvent.KEYCODE_DPAD_CENTER,
            "back", KeyEvent.KEYCODE_BACK,
            "menu", KeyEvent.KEYCODE_MENU);

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String value = Objects.toString(params.get("value"), "");
        switch (Objects.toString(params.get("do"), "")) {
            case "key" -> {
                Integer code = KEYS.get(value);
                if (code == null) return Reply.badRequest("Unknown key");
                return onForeground(activity -> sendKey(activity, code));
            }
            case "text" -> {
                return onForeground(activity -> {
                    View focus = activity.getCurrentFocus();
                    if (!(focus instanceof EditText edit)) return false;
                    edit.setText(value);
                    edit.setSelection(edit.getText().length());
                    return true;
                }, "no text field is focused on the TV");
            }
            case "volume" -> {
                AudioManager audio = (AudioManager) App.get().getSystemService(Context.AUDIO_SERVICE);
                int direction = switch (value) {
                    case "up" -> AudioManager.ADJUST_RAISE;
                    case "down" -> AudioManager.ADJUST_LOWER;
                    case "mute" -> AudioManager.ADJUST_TOGGLE_MUTE;
                    default -> 0;
                };
                if (direction == 0) return Reply.badRequest("Unknown volume");
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                return Reply.ok();
            }
            default -> {
                return Reply.badRequest("Unknown do");
            }
        }
    }

    private interface ActivityAction {

        boolean run(Activity activity);
    }

    private static Response onForeground(ActivityAction action) {
        return onForeground(action, "the app is not in the foreground on the TV");
    }

    private static Response onForeground(ActivityAction action, String error) {
        Boolean done = Reply.onMain(() -> {
            Activity activity = App.activity();
            return activity != null && action.run(activity);
        }, false);
        return Boolean.TRUE.equals(done) ? Reply.ok() : Reply.badRequest(App.activity() == null ? "the app is not in the foreground on the TV" : error);
    }

    private static boolean sendKey(Activity activity, int code) {
        long now = SystemClock.uptimeMillis();
        activity.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0));
        activity.dispatchKeyEvent(new KeyEvent(now, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0));
        return true;
    }
}
