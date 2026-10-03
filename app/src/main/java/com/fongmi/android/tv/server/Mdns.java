package com.fongmi.android.tv.server;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.fongmi.android.tv.App;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.jmdns.JmDNS;
import javax.jmdns.ServiceInfo;

/**
 * Announces the local server on the LAN as {@code tvbox.local} with an {@code _http._tcp}
 * service, so browsers on iPhone, iPad and Mac can open {@code http://tvbox.local:<port>}.
 * Android phones' browsers usually do not resolve {@code .local}; they keep using the IP / QR code.
 */
final class Mdns {

    static final String HOST = "tvbox";

    private static final String SERVICE_TYPE = "_http._tcp.local.";

    private final List<JmDNS> instances = new ArrayList<>();
    private WifiManager.MulticastLock lock;

    synchronized void start(int port) {
        stop();
        acquireLock();
        for (InetAddress address : addresses()) {
            try {
                JmDNS jmdns = JmDNS.create(address, HOST);
                jmdns.registerService(ServiceInfo.create(SERVICE_TYPE, HOST, port, "path=/"));
                instances.add(jmdns);
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
        if (instances.isEmpty()) releaseLock();
    }

    synchronized void stop() {
        for (JmDNS jmdns : instances) {
            try {
                jmdns.unregisterAllServices();
                jmdns.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
        instances.clear();
        releaseLock();
    }

    private static List<InetAddress> addresses() {
        List<InetAddress> result = new ArrayList<>();
        try {
            for (NetworkInterface face : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!face.isUp() || face.isLoopback() || face.isPointToPoint() || !face.supportsMulticast()) continue;
                for (InetAddress address : Collections.list(face.getInetAddresses())) if (address instanceof Inet4Address) result.add(address);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return result;
    }

    private void acquireLock() {
        WifiManager wifi = (WifiManager) App.get().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return;
        lock = wifi.createMulticastLock("mdns");
        lock.setReferenceCounted(false);
        lock.acquire();
    }

    private void releaseLock() {
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
    }
}
