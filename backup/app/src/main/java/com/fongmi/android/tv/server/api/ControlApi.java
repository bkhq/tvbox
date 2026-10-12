package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.server.PlayerCommand;
import com.fongmi.android.tv.server.Server;
import com.fongmi.android.tv.service.PlaybackService;

import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class ControlApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String action = Objects.toString(params.get("do"), "");
        String value = Objects.toString(params.get("value"), "0");
        Consumer<PlaybackService> command;
        try {
            command = PlayerCommand.of(action, value);
        } catch (IllegalArgumentException e) {
            return Reply.badRequest(e.getMessage());
        }
        if (command == null) return Reply.badRequest("Unknown do");
        PlaybackService service = Server.get().getService();
        if (service == null) return Reply.badRequest("player not running");
        App.post(() -> command.accept(service));
        return Reply.ok();
    }
}
