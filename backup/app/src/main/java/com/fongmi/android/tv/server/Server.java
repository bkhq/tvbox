package com.fongmi.android.tv.server;

import com.fongmi.android.tv.service.PlaybackService;
import com.fongmi.android.tv.utils.Task;
import com.github.catvod.Proxy;
import com.github.catvod.utils.Util;

public class Server {

    private volatile PlaybackService service;
    private final Mdns mdns = new Mdns();
    private volatile Nano nano;

    private static class Loader {
        static volatile Server INSTANCE = new Server();
    }

    public static Server get() {
        return Loader.INSTANCE;
    }

    public PlaybackService getService() {
        return service;
    }

    public void setService(PlaybackService service) {
        this.service = service;
    }

    public String getAddress() {
        return getAddress(false);
    }

    public String getAddress(int tab) {
        return getAddress(false) + "?tab=" + tab;
    }

    public String getAddress(String path) {
        return getAddress(true) + path;
    }

    /** The mDNS address, e.g. {@code http://tvbox.local:9978}. */
    public String getLocalName() {
        return "http://" + Mdns.HOST + ".local:" + Proxy.getPort();
    }

    public String getAddress(boolean local) {
        return "http://" + (local ? "127.0.0.1" : Util.getIp()) + ":" + Proxy.getPort();
    }

    public synchronized void start() {
        if (nano != null) return;
        for (int i = 9978; i < 9999; i++) {
            try {
                nano = new Nano(i);
                nano.start(500);
                Proxy.set(i);
                int port = i;
                Task.execute(() -> mdns.start(port));
                break;
            } catch (Throwable e) {
                nano = null;
            }
        }
    }

    public void stop() {
        Task.execute(() -> {
            mdns.stop();
            if (nano != null) nano.stop();
            service = null;
            nano = null;
        });
    }
}
