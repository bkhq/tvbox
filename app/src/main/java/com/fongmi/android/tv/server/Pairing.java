package com.fongmi.android.tv.server;

import android.text.TextUtils;

import com.fongmi.android.tv.App;
import com.github.catvod.utils.Prefers;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;

public class Pairing {

    private static final String KEY = "paired_devices";
    private static final String HEADER = "x-token";
    private static final String[] PROTECTED = {"/api/", "/action", "/file", "/upload", "/newFolder", "/delFolder", "/delFile"};

    private final SecureRandom random;
    private final List<Device> devices;
    private volatile String code;

    private static class Loader {
        static volatile Pairing INSTANCE = new Pairing();
    }

    public static Pairing get() {
        return Loader.INSTANCE;
    }

    private Pairing() {
        random = new SecureRandom();
        devices = new CopyOnWriteArrayList<>(load());
        refreshCode();
    }

    private static List<Device> load() {
        String json = Prefers.getString(KEY);
        if (TextUtils.isEmpty(json)) return Collections.emptyList();
        List<Device> items = App.gson().fromJson(json, TypeToken.getParameterized(List.class, Device.class).getType());
        return items == null ? Collections.emptyList() : items;
    }

    private void save() {
        Prefers.put(KEY, App.gson().toJson(new ArrayList<>(devices)));
    }

    public String getCode() {
        return code;
    }

    public void refreshCode() {
        code = String.format(Locale.ROOT, "%06d", random.nextInt(1000000));
    }

    public List<Device> getDevices() {
        return Collections.unmodifiableList(devices);
    }

    public Device pair(String code, String name, String agent, String ip) {
        if (TextUtils.isEmpty(code) || !code.equals(this.code)) return null;
        Device device = new Device(newToken(), TextUtils.isEmpty(name) ? ip : name, agent, ip);
        devices.add(device);
        refreshCode();
        save();
        return device;
    }

    public boolean unpair(String token) {
        boolean removed = devices.removeIf(device -> device.token.equals(token));
        if (removed) save();
        return removed;
    }

    public Device find(String token) {
        if (TextUtils.isEmpty(token)) return null;
        for (Device device : devices) if (device.token.equals(token)) return device;
        return null;
    }

    public boolean allow(IHTTPSession session, String url) {
        if (isLocal(session.getRemoteIpAddress())) return true;
        if (!isProtected(url)) return true;
        Device device = find(token(session));
        if (device == null) return false;
        if (device.touch(session.getRemoteIpAddress())) save();
        return true;
    }

    public static String token(IHTTPSession session) {
        String token = session.getHeaders().get(HEADER);
        return TextUtils.isEmpty(token) ? session.getParms().get("token") : token;
    }

    private static boolean isLocal(String ip) {
        return "127.0.0.1".equals(ip) || "::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip);
    }

    private static boolean isProtected(String url) {
        if (url.equals("/api/pair")) return false;
        for (String prefix : PROTECTED) if (url.startsWith(prefix)) return true;
        return false;
    }

    private String newToken() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    public static class Device {

        @SerializedName("token")
        private final String token;
        @SerializedName("name")
        private final String name;
        @SerializedName("agent")
        private final String agent;
        @SerializedName("time")
        private final long time;
        @SerializedName("ip")
        private String ip;
        @SerializedName("last")
        private long last;

        private Device(String token, String name, String agent, String ip) {
            this.token = token;
            this.name = name;
            this.agent = Objects.toString(agent, "");
            this.ip = ip;
            this.time = System.currentTimeMillis();
            this.last = time;
        }

        private boolean touch(String ip) {
            long now = System.currentTimeMillis();
            boolean stale = now - last > 60_000 || !ip.equals(this.ip);
            this.ip = ip;
            this.last = now;
            return stale;
        }

        public String getToken() {
            return token;
        }

        public String getName() {
            return name;
        }

        public String getAgent() {
            return agent;
        }

        public String getIp() {
            return ip;
        }

        public long getTime() {
            return time;
        }

        public long getLast() {
            return last;
        }
    }
}
