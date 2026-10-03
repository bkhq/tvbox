package com.github.catvod.net.interceptor;

import androidx.annotation.NonNull;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

public class RequestInterceptor implements Interceptor {

    private final ConcurrentHashMap<String, String> authMap;
    private final ConcurrentHashMap<String, Map<String, String>> fixedMap;

    public RequestInterceptor() {
        authMap = new ConcurrentHashMap<>();
        fixedMap = new ConcurrentHashMap<>();
    }

    /** Headers always sent to {@code host}; they survive {@link #clear()}. Empty headers remove them. */
    public void setFixed(String host, Map<String, String> headers) {
        if (host == null || host.isEmpty()) return;
        if (headers == null || headers.isEmpty()) fixedMap.remove(host);
        else fixedMap.put(host, Map.copyOf(headers));
    }

    public void clear() {
        authMap.clear();
    }

    @NonNull
    @Override
    public Response intercept(@NonNull Chain chain) throws IOException {
        Request request = chain.request();
        Request.Builder builder = request.newBuilder();
        HttpUrl url = request.url();
        checkAuth(url, builder);
        checkFixed(request, url, builder);
        return chain.proceed(builder.build());
    }

    private void checkFixed(Request request, HttpUrl url, Request.Builder builder) {
        Map<String, String> headers = fixedMap.get(url.host());
        if (headers == null) return;
        for (Map.Entry<String, String> entry : headers.entrySet()) if (request.header(entry.getKey()) == null) builder.header(entry.getKey(), entry.getValue());
    }

    private void checkAuth(HttpUrl url, Request.Builder builder) {
        String host = url.host();
        String auth = url.queryParameter("auth");
        if (auth != null) authMap.put(host, auth);
        else if (authMap.containsKey(host)) builder.url(url.newBuilder().addQueryParameter("auth", authMap.get(host)).build());
    }
}
