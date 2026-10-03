package com.fongmi.android.tv.utils;

import android.text.TextUtils;

import com.github.catvod.utils.Prefers;

import java.security.SecureRandom;
import java.util.Locale;

/** Random, persistent id for this install in MAC notation; Android hides real hardware addresses. */
public final class DeviceId {

    private static final String KEY = "airplay_device_id";

    private DeviceId() {
    }

    public static synchronized String get() {
        String id = Prefers.getString(KEY);
        if (!TextUtils.isEmpty(id)) return id;
        byte[] mac = new byte[6];
        new SecureRandom().nextBytes(mac);
        mac[0] = (byte) ((mac[0] | 0x02) & 0xFE);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < mac.length; i++) sb.append(String.format(Locale.ROOT, i == 0 ? "%02X" : ":%02X", mac[i]));
        Prefers.put(KEY, id = sb.toString());
        return id;
    }
}
