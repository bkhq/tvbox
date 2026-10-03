package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.server.Nano;
import com.google.gson.JsonObject;

import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoHTTPD.Response;

public final class Reply {

    private static final String MIME_JSON = "application/json";

    private Reply() {
    }

    public static Response json(JsonObject object) {
        return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, MIME_JSON, object.toString());
    }

    public static Response ok() {
        return Nano.ok();
    }

    public static Response badRequest(String text) {
        return Nano.error(Response.Status.BAD_REQUEST, text);
    }

    public static Response notFound(String text) {
        return Nano.error(Response.Status.NOT_FOUND, text);
    }

    public static Response forbidden(String text) {
        return Nano.error(Response.Status.FORBIDDEN, text);
    }

    public static <T> T onMain(Callable<T> callable, T fallback) {
        FutureTask<T> task = new FutureTask<>(callable);
        App.post(task);
        try {
            return task.get(1, TimeUnit.SECONDS);
        } catch (Exception e) {
            return fallback;
        }
    }
}
