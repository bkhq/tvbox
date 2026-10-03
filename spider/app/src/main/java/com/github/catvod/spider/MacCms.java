package com.github.catvod.spider;

import android.content.Context;

import com.github.catvod.bean.Class;
import com.github.catvod.bean.Result;
import com.github.catvod.bean.Vod;
import com.github.catvod.crawler.Spider;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Util;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A MacCMS (苹果CMS) JSON API as a spider, so a site can carry its own
 * headers, category list and parser instead of the app's built-in type 1.
 *
 * ext is the API URL, or an object:
 * <pre>
 * { "api": "https://…/api.php/provide/vod/",
 *   "categories": ["电影", "2"],                 // type names or ids to keep; all when absent
 *   "header": { "User-Agent": "…" },
 *   "parse": "https://jx.example/?url=" }        // for episodes that are pages, not media
 * </pre>
 */
public class MacCms extends Spider {

    private static final Pattern MEDIA = Pattern.compile("\\.(m3u8|mp4|flv|mkv|mov|avi|ts|mp3|m4a)(\\?|$)", Pattern.CASE_INSENSITIVE);

    private String api;
    private String parse;
    private final Set<String> categories = new HashSet<>();
    private final Map<String, String> header = new HashMap<>();

    @Override
    public void init(Context context, String extend) {
        String ext = extend == null ? "" : extend.trim();
        if (!ext.startsWith("{")) {
            api = ext;
            header.put("User-Agent", Util.CHROME);
            return;
        }
        JsonObject object = JsonParser.parseString(ext).getAsJsonObject();
        api = string(object, "api");
        parse = string(object, "parse");
        if (object.has("categories") && object.get("categories").isJsonArray())
            for (JsonElement item : object.getAsJsonArray("categories")) categories.add(item.getAsString());
        if (object.has("header") && object.get("header").isJsonObject())
            for (Map.Entry<String, JsonElement> entry : object.getAsJsonObject("header").entrySet()) header.put(entry.getKey(), entry.getValue().getAsString());
        if (!header.containsKey("User-Agent")) header.put("User-Agent", Util.CHROME);
    }

    @Override
    public String homeContent(boolean filter) {
        JsonObject object = fetch("ac=list");
        List<Class> classes = new ArrayList<>();
        for (JsonElement item : array(object, "class")) {
            JsonObject type = item.getAsJsonObject();
            String id = string(type, "type_id");
            String name = string(type, "type_name");
            if (categories.isEmpty() || categories.contains(id) || categories.contains(name)) classes.add(new Class(id, name));
        }
        return Result.string(classes, new ArrayList<Vod>());
    }

    @Override
    public String homeVideoContent() {
        return Result.string(vods(fetch("ac=detail&pg=1")));
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend) {
        JsonObject object = fetch("ac=detail&t=" + encode(tid) + "&pg=" + encode(pg));
        return Result.get().vod(vods(object)).page(integer(object, "page"), integer(object, "pagecount"), integer(object, "limit"), integer(object, "total")).string();
    }

    @Override
    public String detailContent(List<String> ids) {
        return Result.string(vods(fetch("ac=detail&ids=" + encode(String.join(",", ids)))));
    }

    @Override
    public String searchContent(String key, boolean quick) {
        return searchContent(key, quick, "1");
    }

    @Override
    public String searchContent(String key, boolean quick, String pg) {
        return Result.string(vods(fetch("ac=detail&wd=" + encode(key) + "&pg=" + encode(pg))));
    }

    @Override
    public String playerContent(String flag, String id, List<String> vipFlags) {
        if (MEDIA.matcher(id).find()) return Result.get().url(id).header(header).string();
        if (parse != null && !parse.isEmpty()) return Result.get().url(parse + id).parse().string();
        Result result = Result.get().url(id).parse();
        return (vipFlags != null && vipFlags.contains(flag) ? result.jx() : result).string();
    }

    private JsonObject fetch(String query) {
        String body = OkHttp.string(api + (api.contains("?") ? "&" : "?") + query, header);
        try {
            return JsonParser.parseString(body).getAsJsonObject();
        } catch (Exception e) {
            return new JsonObject();
        }
    }

    private static List<Vod> vods(JsonObject object) {
        List<Vod> list = new ArrayList<>();
        for (JsonElement item : array(object, "list")) list.add(Vod.objectFrom(item.toString()));
        return list;
    }

    private static JsonArray array(JsonObject object, String key) {
        return object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : new JsonArray();
    }

    private static String string(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : null;
    }

    private static int integer(JsonObject object, String key) {
        try {
            return Integer.parseInt(string(object, key));
        } catch (Exception e) {
            return 0;
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
