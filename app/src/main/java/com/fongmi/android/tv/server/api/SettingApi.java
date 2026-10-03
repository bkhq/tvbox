package com.fongmi.android.tv.server.api;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

/** Changes one setting described by {@link SettingRegistry}. */
public class SettingApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String key = Objects.toString(params.get("key"), "");
        String value = Objects.toString(params.get("value"), "");
        return SettingRegistry.set(key, value) ? Reply.ok() : Reply.badRequest("Unknown key");
    }
}
