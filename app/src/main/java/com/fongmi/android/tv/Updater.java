package com.fongmi.android.tv;

import android.app.Activity;
import android.text.TextUtils;

import androidx.appcompat.app.AlertDialog;

import com.fongmi.android.tv.utils.FileUtil;
import com.fongmi.android.tv.utils.Notify;
import com.fongmi.android.tv.utils.ResUtil;
import com.fongmi.android.tv.utils.Task;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Path;
import com.github.catvod.utils.Util;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.Response;

/**
 * Checks the worker's update manifest for this flavor and installs a newer
 * APK. The manifest lives at {@code UPDATE_URL/stable/<mode>-<abi>.json};
 * builds without an update URL never check.
 */
public class Updater {

    private static final String CHANNEL = "stable";

    private static final class Release {

        final int code;
        final String name;
        final String notes;
        final String url;
        final String sha256;

        Release(int code, String name, String notes, String url, String sha256) {
            this.code = code;
            this.name = name;
            this.notes = notes;
            this.url = url;
            this.sha256 = sha256;
        }
    }

    public static void check(Activity activity, boolean manual) {
        if (TextUtils.isEmpty(BuildConfig.UPDATE_URL)) {
            if (manual) Notify.show(R.string.update_unavailable);
            return;
        }
        if (manual) Notify.show(R.string.update_check);
        String url = BuildConfig.UPDATE_URL + "/" + CHANNEL + "/" + BuildConfig.FLAVOR_mode + "-" + BuildConfig.FLAVOR_abi + ".json";
        Task.execute(() -> {
            try {
                Release release = fetch(url);
                if (release == null || release.code <= BuildConfig.VERSION_CODE) {
                    if (manual) App.post(() -> Notify.show(R.string.update_latest));
                    return;
                }
                App.post(() -> prompt(activity, release));
            } catch (Exception e) {
                e.printStackTrace();
                if (manual) App.post(() -> Notify.show(R.string.update_failed));
            }
        });
    }

    private static Release fetch(String url) throws Exception {
        try (Response res = OkHttp.newCall(url).execute()) {
            // No manifest means nothing has been released for this flavor.
            if (res.code() == 404) return null;
            if (!res.isSuccessful()) throw new IOException("HTTP " + res.code());
            JSONObject json = new JSONObject(res.body().string());
            String apk = HttpUrl.get(url).resolve(json.getString("url")).toString();
            return new Release(json.getInt("versionCode"), json.getString("versionName"), json.optString("notes"), apk, json.getString("sha256"));
        }
    }

    private static void prompt(Activity activity, Release release) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        String notes = TextUtils.isEmpty(release.notes) ? ResUtil.getString(R.string.update_no_notes) : release.notes;
        new MaterialAlertDialogBuilder(activity)
                .setTitle(ResUtil.getString(R.string.update_title, release.name))
                .setMessage(notes)
                .setNegativeButton(R.string.dialog_negative, null)
                .setPositiveButton(R.string.update_install, (dialog, which) -> download(activity, release))
                .show();
    }

    private static void download(Activity activity, Release release) {
        AtomicBoolean canceled = new AtomicBoolean();
        File file = Path.cache("update.apk");
        Call call = OkHttp.newCall(release.url);
        AlertDialog progress = new MaterialAlertDialogBuilder(activity)
                .setTitle(ResUtil.getString(R.string.update_title, release.name))
                .setMessage(ResUtil.getString(R.string.update_downloading, 0))
                .setCancelable(false)
                .setNegativeButton(R.string.dialog_negative, (dialog, which) -> {
                    canceled.set(true);
                    call.cancel();
                })
                .show();
        Task.execute(() -> {
            try (Response res = call.execute()) {
                if (!res.isSuccessful()) throw new IOException("HTTP " + res.code());
                long total = res.body().contentLength();
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream in = res.body().byteStream(); OutputStream out = new FileOutputStream(file)) {
                    byte[] buffer = new byte[64 * 1024];
                    long done = 0;
                    int shown = 0;
                    for (int n; (n = in.read(buffer)) != -1; ) {
                        out.write(buffer, 0, n);
                        digest.update(buffer, 0, n);
                        done += n;
                        int percent = total > 0 ? (int) (done * 100 / total) : 0;
                        if (percent != shown) {
                            shown = percent;
                            App.post(() -> progress.setMessage(ResUtil.getString(R.string.update_downloading, percent)));
                        }
                    }
                }
                if (!MessageDigest.isEqual(digest.digest(), Util.hex2byte(release.sha256))) throw new IOException("sha256 mismatch");
                App.post(() -> {
                    progress.dismiss();
                    FileUtil.openFile(file);
                });
            } catch (Exception e) {
                e.printStackTrace();
                file.delete();
                App.post(() -> {
                    progress.dismiss();
                    if (!canceled.get()) Notify.show(R.string.update_failed);
                });
            }
        });
    }
}
