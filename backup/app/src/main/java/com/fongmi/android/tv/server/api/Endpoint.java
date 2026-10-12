package com.fongmi.android.tv.server.api;

import java.util.Map;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public interface Endpoint {

    Response handle(IHTTPSession session, Map<String, String> params) throws Exception;
}
