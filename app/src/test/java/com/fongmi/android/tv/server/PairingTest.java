package com.fongmi.android.tv.server;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;

@RunWith(RobolectricTestRunner.class)
public class PairingTest {

    private static final String PHONE = "192.168.1.20";

    private Pairing.Device paired;

    @After
    public void unpair() {
        if (paired != null) Pairing.get().unpair(paired.getToken());
    }

    @Test
    public void wrongCodeDoesNotPair() {
        String code = Pairing.get().getCode();
        assertNull(Pairing.get().pair(code.equals("000000") ? "000001" : "000000", "phone", "agent", PHONE));
        assertNull(Pairing.get().pair("", "phone", "agent", PHONE));
        assertEquals(code, Pairing.get().getCode());
    }

    @Test
    public void codeIsSingleUse() {
        String code = Pairing.get().getCode();
        paired = Pairing.get().pair(code, "phone", "agent", PHONE);
        assertNotNull(paired);
        assertEquals("phone", paired.getName());
        assertNotEquals(code, Pairing.get().getCode());
        assertNull(Pairing.get().pair(code, "again", "agent", PHONE));
    }

    @Test
    public void unnamedDeviceIsNamedByItsAddress() {
        paired = Pairing.get().pair(Pairing.get().getCode(), "", null, PHONE);
        assertEquals(PHONE, paired.getName());
        assertEquals("", paired.getAgent());
    }

    @Test
    public void protectedPathsNeedAToken() {
        assertFalse(Pairing.get().allow(session(PHONE, null), "/api/state"));
        assertFalse(Pairing.get().allow(session(PHONE, "bogus"), "/api/control"));
        assertFalse(Pairing.get().allow(session(PHONE, null), "/action"));
        assertFalse(Pairing.get().allow(session(PHONE, null), "/upload"));
    }

    @Test
    public void pairedTokenIsAcceptedFromHeaderOrQuery() {
        paired = Pairing.get().pair(Pairing.get().getCode(), "phone", "agent", PHONE);
        assertTrue(Pairing.get().allow(session(PHONE, paired.getToken()), "/api/state"));
        assertTrue(Pairing.get().allow(query(PHONE, paired.getToken()), "/file/a.mp4"));
        Pairing.get().unpair(paired.getToken());
        assertFalse(Pairing.get().allow(session(PHONE, paired.getToken()), "/api/state"));
        paired = null;
    }

    @Test
    public void openPathsAndLoopbackSkipTheToken() {
        assertTrue(Pairing.get().allow(session(PHONE, null), "/api/pair"));
        assertTrue(Pairing.get().allow(session(PHONE, null), "/"));
        assertTrue(Pairing.get().allow(session(PHONE, null), "/proxy?do=js"));
        assertTrue(Pairing.get().allow(session("127.0.0.1", null), "/api/state"));
    }

    private static IHTTPSession session(String ip, String token) {
        Map<String, String> headers = new HashMap<>();
        if (token != null) headers.put("x-token", token);
        return fake(ip, headers, new HashMap<>());
    }

    private static IHTTPSession query(String ip, String token) {
        Map<String, String> params = new HashMap<>();
        params.put("token", token);
        return fake(ip, new HashMap<>(), params);
    }

    @SuppressWarnings("deprecation")
    private static IHTTPSession fake(String ip, Map<String, String> headers, Map<String, String> params) {
        return (IHTTPSession) Proxy.newProxyInstance(IHTTPSession.class.getClassLoader(), new Class<?>[]{IHTTPSession.class}, (proxy, method, args) -> switch (method.getName()) {
            case "getRemoteIpAddress" -> ip;
            case "getHeaders" -> headers;
            case "getParms" -> params;
            default -> throw new UnsupportedOperationException(method.getName());
        });
    }
}
