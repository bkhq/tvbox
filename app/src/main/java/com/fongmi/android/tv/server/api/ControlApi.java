package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.server.Server;
import com.fongmi.android.tv.service.PlaybackService;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class ControlApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String action = Objects.toString(params.get("do"), "");
        String value = Objects.toString(params.get("value"), "0");
        PlaybackService service = Server.get().getService();
        if (service == null) return Reply.badRequest("player not running");
        Runnable runnable = switch (action) {
            case "play" -> () -> service.player().play();
            case "pause" -> () -> service.player().pause();
            case "toggle" -> () -> {
                if (service.player().isPlaying()) service.player().pause();
                else service.player().play();
            };
            case "stop" -> service::dispatchStop;
            case "prev" -> service::dispatchPrev;
            case "next" -> service::dispatchNext;
            case "seek" -> () -> service.player().seekTo(Math.max(0, service.player().getPosition() + Long.parseLong(value)));
            case "speed" -> () -> service.player().setSpeed(Float.parseFloat(value));
            default -> null;
        };
        if (runnable == null) return Reply.badRequest("Unknown do");
        App.post(runnable);
        return Reply.ok();
    }
}
