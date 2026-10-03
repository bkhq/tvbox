package com.github.catvod.spider;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import org.junit.AfterClass;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

import static com.github.catvod.spider.TestSupport.object;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class MacCmsTest {

    private static final String LIST = "{\"code\":1,\"class\":[{\"type_id\":1,\"type_name\":\"电影\"},{\"type_id\":2,\"type_name\":\"电视剧\"},{\"type_id\":3,\"type_name\":\"伦理\"}],\"list\":[]}";
    private static final String DETAIL = "{\"code\":1,\"page\":2,\"pagecount\":9,\"limit\":\"20\",\"total\":170,\"list\":[{\"vod_id\":42,\"vod_name\":\"片名\",\"vod_pic\":\"https://img/42.jpg\",\"vod_remarks\":\"HD\",\"type_name\":\"电影\",\"vod_play_from\":\"m3u8$$$qq\",\"vod_play_url\":\"第1集$https://cdn/1.m3u8#第2集$https://cdn/2.m3u8$$$正片$https://v.qq.com/x/1.html\"}]}";

    private static ServerSocket server;
    private static final List<String> queries = Collections.synchronizedList(new ArrayList<>());
    private static String api;

    // A one-request-per-connection HTTP server: enough for OkHttp, and the
    // JDK's HttpServer is not on an Android unit test's classpath.
    @BeforeClass
    public static void start() throws Exception {
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        Thread thread = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket socket = server.accept()) {
                    serve(socket);
                } catch (Exception ignored) {
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
        api = "http://127.0.0.1:" + server.getLocalPort() + "/api.php/provide/vod/";
    }

    private static void serve(Socket socket) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        String target = in.readLine().split(" ")[1];
        String ua = "";
        for (String line = in.readLine(); line != null && !line.isEmpty(); line = in.readLine())
            if (line.toLowerCase().startsWith("user-agent:")) ua = line.substring(11).trim();
        String query = target.contains("?") ? target.substring(target.indexOf('?') + 1) : "";
        queries.add(query + " ua=" + ua);
        byte[] body = (query.startsWith("ac=list") ? LIST : DETAIL).getBytes(StandardCharsets.UTF_8);
        OutputStream out = socket.getOutputStream();
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    @AfterClass
    public static void stop() throws Exception {
        server.close();
    }

    @Before
    public void clear() {
        queries.clear();
    }

    private static MacCms spider(String ext) throws Exception {
        MacCms spider = new MacCms();
        spider.init(null, ext);
        return spider;
    }

    @Test
    public void extIsTheApiUrlOrAnObject() throws Exception {
        assertEquals(3, object(spider(api).homeContent(false)).getAsJsonArray("class").size());
        JsonObject home = object(spider("{\"api\":\"" + api + "\",\"categories\":[\"电影\",\"2\"]}").homeContent(false));
        JsonArray classes = home.getAsJsonArray("class");
        assertEquals(2, classes.size());
        assertEquals("电影", classes.get(0).getAsJsonObject().get("type_name").getAsString());
        assertEquals("2", classes.get(1).getAsJsonObject().get("type_id").getAsString());
    }

    @Test
    public void categoryPagesThroughTheApi() throws Exception {
        JsonObject result = object(spider(api).categoryContent("1", "2", false, new HashMap<>()));
        assertEquals("ac=detail&t=1&pg=2 ua=" + com.github.catvod.utils.Util.CHROME, queries.get(0));
        assertEquals(9, result.get("pagecount").getAsInt());
        assertEquals(170, result.get("total").getAsInt());
        assertEquals("42", result.getAsJsonArray("list").get(0).getAsJsonObject().get("vod_id").getAsString());
    }

    @Test
    public void detailAndSearchAskForWhatTheyNeed() throws Exception {
        MacCms spider = spider("{\"api\":\"" + api + "\",\"header\":{\"User-Agent\":\"mine\"}}");
        JsonObject detail = object(spider.detailContent(Arrays.asList("42", "43")));
        assertTrue(detail.getAsJsonArray("list").get(0).getAsJsonObject().get("vod_play_url").getAsString().startsWith("第1集$"));
        object(spider.searchContent("片 名", false));
        object(spider.searchContent("片", false, "3"));
        assertEquals("ac=detail&ids=42%2C43 ua=mine", queries.get(0));
        assertEquals("ac=detail&wd=%E7%89%87+%E5%90%8D&pg=1 ua=mine", queries.get(1));
        assertEquals("ac=detail&wd=%E7%89%87&pg=3 ua=mine", queries.get(2));
    }

    @Test
    public void mediaPlaysDirectlyAndPagesGoToTheParser() throws Exception {
        JsonObject direct = object(spider(api).playerContent("m3u8", "https://cdn/1.m3u8", Collections.emptyList()));
        assertEquals("https://cdn/1.m3u8", direct.get("url").getAsString());
        assertEquals(0, direct.get("parse").getAsInt());

        JsonObject vip = object(spider(api).playerContent("qq", "https://v.qq.com/x/1.html", Collections.singletonList("qq")));
        assertEquals("https://v.qq.com/x/1.html", vip.get("url").getAsString());
        assertEquals(1, vip.get("parse").getAsInt());
        assertEquals(1, vip.get("jx").getAsInt());

        JsonObject own = object(spider("{\"api\":\"" + api + "\",\"parse\":\"https://jx.example/?url=\"}").playerContent("qq", "https://v.qq.com/x/1.html", Collections.emptyList()));
        assertEquals("https://jx.example/?url=https://v.qq.com/x/1.html", own.get("url").getAsString());
        assertEquals(1, own.get("parse").getAsInt());
        assertFalse(own.has("jx") && own.get("jx").getAsInt() == 1);
    }
}
