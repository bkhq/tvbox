package com.fongmi.android.tv.ui.dialog;

import android.app.Activity;

import com.fongmi.android.tv.Enroll;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.utils.ResUtil;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

/** Shows the device code and lets the user request or remove the link with the server. */
public final class EnrollDialog {

    private EnrollDialog() {
    }

    public static void show(Activity activity, Runnable onChange) {
        Enroll.State state = Enroll.getState();
        String message = ResUtil.getString(R.string.enroll_message, Enroll.getCode(), getStateText(state));
        MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(activity).setTitle(R.string.setting_server).setMessage(message).setNegativeButton(R.string.dialog_negative, null);
        if (state == Enroll.State.OFF) builder.setPositiveButton(R.string.enroll_request, (dialog, which) -> {
            Enroll.request();
            onChange.run();
        });
        else builder.setPositiveButton(R.string.enroll_unlink, (dialog, which) -> {
            Enroll.unlink();
            onChange.run();
        }).setNeutralButton(R.string.enroll_refresh, (dialog, which) -> {
            Enroll.refresh();
            onChange.run();
        });
        builder.show();
    }

    public static String getStateText(Enroll.State state) {
        return switch (state) {
            case OFF -> ResUtil.getString(R.string.enroll_off);
            case PENDING -> ResUtil.getString(R.string.enroll_waiting);
            case LINKED -> ResUtil.getString(R.string.enroll_linked);
        };
    }
}
