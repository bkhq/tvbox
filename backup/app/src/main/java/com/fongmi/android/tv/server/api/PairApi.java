package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.server.Pairing;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class PairApi implements Endpoint {

    private final boolean pair;

    private PairApi(boolean pair) {
        this.pair = pair;
    }

    public static PairApi pair() {
        return new PairApi(true);
    }

    public static PairApi unpair() {
        return new PairApi(false);
    }

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        return pair ? pair(session, params) : unpair(params);
    }

    private static Response pair(IHTTPSession session, Map<String, String> params) {
        String agent = session.getHeaders().get("user-agent");
        Pairing.Device device = Pairing.get().pair(params.get("code"), params.get("name"), agent, session.getRemoteIpAddress());
        if (device == null) return Reply.forbidden("wrong code");
        JsonObject object = new JsonObject();
        object.addProperty("token", device.getToken());
        object.addProperty("name", device.getName());
        return Reply.json(object);
    }

    private static Response unpair(Map<String, String> params) {
        return Pairing.get().unpair(Objects.toString(params.get("target"), "")) ? Reply.ok() : Reply.notFound("device not found");
    }

    static JsonArray devices() {
        JsonArray array = new JsonArray();
        for (Pairing.Device device : Pairing.get().getDevices()) {
            JsonObject item = new JsonObject();
            item.addProperty("token", device.getToken());
            item.addProperty("name", device.getName());
            item.addProperty("agent", device.getAgent());
            item.addProperty("ip", device.getIp());
            item.addProperty("time", device.getTime());
            item.addProperty("last", device.getLast());
            array.add(item);
        }
        return array;
    }
}
