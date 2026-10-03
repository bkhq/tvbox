package com.fongmi.android.tv.server.process;

import com.fongmi.android.tv.server.Nano;
import com.fongmi.android.tv.server.api.ActionApi;
import com.fongmi.android.tv.server.api.ConfigApi;
import com.fongmi.android.tv.server.api.ControlApi;
import com.fongmi.android.tv.server.api.Endpoint;
import com.fongmi.android.tv.server.api.EnrollApi;
import com.fongmi.android.tv.server.api.PairApi;
import com.fongmi.android.tv.server.api.SettingApi;
import com.fongmi.android.tv.server.api.StateApi;
import com.fongmi.android.tv.server.impl.Process;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class Api implements Process {

    private static final String PREFIX = "/api/";

    private final Map<String, Endpoint> endpoints;

    public Api() {
        endpoints = new HashMap<>();
        endpoints.put("state", new StateApi());
        endpoints.put("pair", PairApi.pair());
        endpoints.put("unpair", PairApi.unpair());
        endpoints.put("config", new ConfigApi());
        endpoints.put("setting", new SettingApi());
        endpoints.put("control", new ControlApi());
        endpoints.put("enroll", new EnrollApi());
        endpoints.put("push", ActionApi.of("push"));
        endpoints.put("search", ActionApi.of("search"));
        endpoints.put("file", ActionApi.of("file"));
    }

    @Override
    public boolean isRequest(IHTTPSession session, String url) {
        return url.startsWith(PREFIX);
    }

    @Override
    public Response doResponse(IHTTPSession session, String url, Map<String, String> files) {
        Endpoint endpoint = endpoints.get(url.substring(PREFIX.length()));
        if (endpoint == null) return Nano.error(Response.Status.NOT_FOUND, "Unknown api");
        try {
            return endpoint.handle(session, session.getParms());
        } catch (Throwable e) {
            e.printStackTrace();
            return Nano.error(Objects.toString(e.getMessage(), e.toString()));
        }
    }
}
