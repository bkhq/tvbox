package com.fongmi.android.tv.ui.dialog;

import android.app.Activity;
import android.text.InputType;
import android.widget.EditText;
import android.widget.FrameLayout;

import com.fongmi.android.tv.R;
import com.fongmi.android.tv.airplay.AirPlay;
import com.fongmi.android.tv.setting.Setting;
import com.fongmi.android.tv.utils.ResUtil;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

/** Renames the AirPlay receiver or turns it on and off; changes restart the receiver at once. */
public final class AirPlayDialog {

    private AirPlayDialog() {
    }

    public static void show(Activity activity, Runnable onChange) {
        EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(AirPlay.getName());
        input.setSelection(input.getText().length());
        FrameLayout frame = new FrameLayout(activity);
        int padding = ResUtil.dp2px(24);
        frame.setPadding(padding, ResUtil.dp2px(8), padding, 0);
        frame.addView(input);
        boolean enabled = Setting.isAirPlay();
        new MaterialAlertDialogBuilder(activity)
                .setTitle(R.string.setting_airplay)
                .setMessage(R.string.airplay_name_hint)
                .setView(frame)
                .setPositiveButton(R.string.dialog_positive, (dialog, which) -> {
                    Setting.putAirPlayName(input.getText().toString().trim());
                    if (enabled) AirPlay.get().restart();
                    onChange.run();
                })
                .setNeutralButton(enabled ? R.string.airplay_turn_off : R.string.airplay_turn_on, (dialog, which) -> {
                    Setting.putAirPlay(!enabled);
                    if (enabled) AirPlay.get().stop();
                    else AirPlay.get().start();
                    onChange.run();
                })
                .setNegativeButton(R.string.dialog_negative, null)
                .show();
    }

    public static String getText() {
        return Setting.isAirPlay() ? AirPlay.getName() : ResUtil.getString(R.string.airplay_off);
    }
}
