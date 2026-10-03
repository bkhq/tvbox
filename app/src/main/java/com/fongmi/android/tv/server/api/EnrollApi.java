package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.Enroll;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

/** The server link from the phone control page: same actions as the TV dialog. */
public class EnrollApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        if (!Enroll.isAvailable()) return Reply.badRequest("server link not available in this build");
        switch (Objects.toString(params.get("do"), "")) {
            case "request" -> Enroll.request();
            case "refresh" -> Enroll.refresh();
            case "unlink" -> Enroll.unlink();
            default -> {
                return Reply.badRequest("Unknown do");
            }
        }
        return Reply.ok();
    }
}
