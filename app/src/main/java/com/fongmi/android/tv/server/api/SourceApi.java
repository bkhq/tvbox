package com.fongmi.android.tv.server.api;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.R;
import com.fongmi.android.tv.api.config.LiveConfig;
import com.fongmi.android.tv.api.config.VodConfig;
import com.fongmi.android.tv.bean.Live;
import com.fongmi.android.tv.bean.Parse;
import com.fongmi.android.tv.bean.Site;
import com.fongmi.android.tv.db.AppDatabase;
import com.fongmi.android.tv.impl.Callback;
import com.fongmi.android.tv.utils.FileUtil;
import com.fongmi.android.tv.utils.Notify;
import com.github.catvod.utils.Path;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.Map;
import java.util.Objects;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

/**
 * Home site, live source and parser of the loaded configs, plus cache and backup maintenance.
 * Changes run on the main thread, as they do from the TV settings screen.
 */
public class SourceApi implements Endpoint {

    @Override
    public Response handle(IHTTPSession session, Map<String, String> params) {
        String value = Objects.toString(params.get("value"), "");
        switch (Objects.toString(params.get("do"), "")) {
            case "site" -> {
                Site site = VodConfig.get().getSite(value);
                if (site.isEmpty()) return Reply.notFound("site not found");
                App.post(() -> VodConfig.get().setHome(site));
            }
            case "live" -> {
                Live live = LiveConfig.get().getLive(value);
                if (live.isEmpty()) return Reply.notFound("live not found");
                App.post(() -> LiveConfig.get().setHome(live));
            }
            case "parse" -> {
                Parse parse = VodConfig.get().getParse(value);
                if (parse.isEmpty()) return Reply.notFound("parse not found");
                App.post(() -> VodConfig.get().setParse(parse));
            }
            case "cache" -> FileUtil.clearCache(new Callback());
            case "backup" -> AppDatabase.backup(new Callback() {
                @Override
                public void success() {
                    Notify.show(R.string.backup_success);
                }

                @Override
                public void error() {
                    Notify.show(R.string.backup_fail);
                }
            });
            default -> {
                return Reply.badRequest("Unknown do");
            }
        }
        return Reply.ok();
    }

    static JsonObject toJson() {
        JsonObject object = new JsonObject();
        JsonArray sites = new JsonArray();
        for (Site site : VodConfig.get().getSites()) sites.add(item(site.getKey(), site.getName()));
        object.add("sites", sites);
        object.addProperty("site", VodConfig.get().getHome().getKey());
        JsonArray lives = new JsonArray();
        for (Live live : LiveConfig.get().getLives()) lives.add(item(live.getName(), live.getName()));
        object.add("lives", lives);
        object.addProperty("live", LiveConfig.get().getHome().getName());
        JsonArray parses = new JsonArray();
        for (Parse parse : VodConfig.get().getParses()) parses.add(item(parse.getName(), parse.getName()));
        object.add("parses", parses);
        object.addProperty("parse", VodConfig.get().getParse().getName());
        return object;
    }

    /** Walks the cache directory; call it off the main thread. */
    static String cacheSize() {
        return FileUtil.byteCountToDisplaySize(FileUtil.getDirectorySize(Path.cache()));
    }

    private static JsonObject item(String key, String name) {
        JsonObject object = new JsonObject();
        object.addProperty("key", key);
        object.addProperty("name", name);
        return object;
    }
}
