package com.fongmi.android.tv.api.parser;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.fongmi.android.tv.bean.Channel;
import com.fongmi.android.tv.bean.Group;
import com.fongmi.android.tv.bean.Live;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import java.util.List;

@RunWith(RobolectricTestRunner.class)
public class LiveParserTest {

    private static Live parse(String text) {
        Live live = new Live("test", "");
        LiveParser.text(live, text);
        return live;
    }

    private static Channel channel(Live live, int group, int channel) {
        return live.getGroups().get(group).getChannel().get(channel);
    }

    @Test
    public void m3uGroupsChannelsByGroupTitle() {
        Live live = parse("""
                #EXTM3U x-tvg-url="https://epg.example/e.xml"
                #EXTINF:-1 tvg-id="c1" tvg-name="CCTV1" tvg-logo="https://logo/1.png" group-title="News",CCTV-1
                http://a.example/1.m3u8
                #EXTINF:-1 group-title="Movies",Film
                http://a.example/2.m3u8
                #EXTINF:-1 group-title="News",CCTV-2
                http://a.example/3.m3u8
                """);
        List<Group> groups = live.getGroups();
        assertEquals(2, groups.size());
        assertEquals("News", groups.get(0).getName());
        assertEquals(2, groups.get(0).getChannel().size());
        Channel first = channel(live, 0, 0);
        assertEquals("CCTV-1", first.getName());
        assertEquals("c1", first.getTvgId());
        assertEquals("CCTV1", first.getTvgName());
        assertEquals("https://logo/1.png", first.getLogo());
        assertEquals(List.of("http://a.example/1.m3u8"), first.getUrls());
    }

    @Test
    public void m3uRepeatedChannelCollectsLines() {
        Live live = parse("""
                #EXTM3U
                #EXTINF:-1 group-title="News",CCTV-1
                http://a.example/1.m3u8
                #EXTINF:-1 group-title="News",CCTV-1
                http://b.example/1.m3u8
                """);
        assertEquals(1, live.getGroups().get(0).getChannel().size());
        assertEquals(List.of("http://a.example/1.m3u8", "http://b.example/1.m3u8"), channel(live, 0, 0).getUrls());
    }

    @Test
    public void m3uOptionsApplyToTheNextUrlOnly() {
        Live live = parse("""
                #EXTM3U
                #EXTINF:-1 group-title="G",One
                #EXTVLCOPT:http-user-agent=Agent/1
                #EXTVLCOPT:http-referrer=https://ref.example/
                http://a.example/1.m3u8
                #EXTINF:-1 group-title="G",Two
                http://a.example/2.m3u8|Origin=https://o.example&X-Key=v
                """);
        Channel one = channel(live, 0, 0);
        assertEquals("Agent/1", one.getUa());
        assertEquals("https://ref.example/", one.getReferer());
        Channel two = channel(live, 0, 1);
        assertEquals("", two.getUa());
        assertEquals(List.of("http://a.example/2.m3u8"), two.getUrls());
        assertEquals("v", two.getHeader().get("X-Key"));
        assertEquals("https://o.example", two.getHeader().get("Origin"));
    }

    @Test
    public void channelsWithoutANumberAreNumberedInOrder() {
        Live live = parse("""
                #EXTM3U
                #EXTINF:-1 group-title="A",One
                http://a.example/1
                #EXTINF:-1 tvg-chno="42" group-title="A",Two
                http://a.example/2
                #EXTINF:-1 group-title="B",Three
                http://a.example/3
                """);
        assertEquals("001", channel(live, 0, 0).getNumber());
        assertEquals("42", channel(live, 0, 1).getNumber());
        assertEquals("002", channel(live, 1, 0).getNumber());
    }

    @Test
    public void txtGroupsByGenreLines() {
        Live live = parse("""
                News,#genre#
                CCTV-1,http://a.example/1.m3u8
                CCTV-1,http://b.example/1.m3u8
                CCTV-2,http://a.example/2.m3u8#http://b.example/2.m3u8
                Movies,#genre#
                Film,http://a.example/3.m3u8
                """);
        List<Group> groups = live.getGroups();
        assertEquals(2, groups.size());
        assertEquals("News", groups.get(0).getName());
        assertEquals(List.of("http://a.example/1.m3u8", "http://b.example/1.m3u8"), channel(live, 0, 0).getUrls());
        assertEquals(List.of("http://a.example/2.m3u8", "http://b.example/2.m3u8"), channel(live, 0, 1).getUrls());
        assertEquals("Film", channel(live, 1, 0).getName());
    }

    @Test
    public void txtWithoutGenreGetsADefaultGroup() {
        Live live = parse("One,http://a.example/1\nnot a channel\nTwo,rtmp://a.example/2\n");
        assertEquals(1, live.getGroups().size());
        assertEquals(2, live.getGroups().get(0).getChannel().size());
    }

    @Test
    public void txtUaLineAppliesUntilTheNextGenre() {
        Live live = parse("""
                A,#genre#
                ua=Agent/2
                One,http://a.example/1
                B,#genre#
                Two,http://a.example/2
                """);
        assertEquals("Agent/2", channel(live, 0, 0).getUa());
        assertTrue(channel(live, 1, 0).getUa().isEmpty());
    }
}
