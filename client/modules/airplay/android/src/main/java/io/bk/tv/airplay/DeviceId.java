package io.bk.tv.airplay;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;

import java.security.SecureRandom;
import java.util.Locale;

/** Random, persistent id for this install in MAC notation; Android hides real hardware addresses. */
final class DeviceId {

    private static final String PREFS = "airplay";
    private static final String KEY = "airplay_device_id";

    private DeviceId() {
    }

    static synchronized String get(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY, null);
        if (!TextUtils.isEmpty(id)) return id;
        byte[] mac = new byte[6];
        new SecureRandom().nextBytes(mac);
        mac[0] = (byte) ((mac[0] | 0x02) & 0xFE);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < mac.length; i++) sb.append(String.format(Locale.ROOT, i == 0 ? "%02X" : ":%02X", mac[i]));
        prefs.edit().putString(KEY, id = sb.toString()).apply();
        return id;
    }
}
