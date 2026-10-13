import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb } from "../test-db";
import { createChannel, createGroup, deleteGroup, exportM3u, getEpg, importM3u, listChannels, listGroups, updateChannel } from "./live.service";
import { parseM3u } from "./m3u";

let db: AppDatabase;
let dispose: () => void;

beforeEach(async () => {
  ({ db, dispose } = await openTestDb());
});

afterEach(() => dispose());

const PLAYLIST = `#EXTM3U x-tvg-url="https://epg.example/e.xml"
#EXTINF:-1 tvg-id="CCTV1" tvg-chno="1" tvg-logo="https://l/1.png" group-title="央视",CCTV-1 综合
https://a/cctv1.m3u8
#EXTINF:-1 tvg-id="CCTV1" group-title="央视",CCTV-1 综合
#EXTVLCOPT:http-user-agent=okhttp
#EXTVLCOPT:http-referrer=https://ref.example/
https://b/cctv1.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
rtmp://c/hunan
`;

describe("m3u", () => {
  test("an M3U keeps its attributes, headers and EPG", () => {
    const { epg, channels } = parseM3u(PLAYLIST);
    expect(epg).toEqual(["https://epg.example/e.xml"]);
    expect(channels).toHaveLength(3);
    expect(channels[0]).toMatchObject({ group: "央视", name: "CCTV-1 综合", number: 1, tvgId: "CCTV1", logo: "https://l/1.png" });
    expect(channels[1]).toMatchObject({ userAgent: "okhttp", referer: "https://ref.example/" });
  });

  test("a TVBox txt list reads groups from #genre# lines and splits # lines", () => {
    const { channels } = parseM3u("央视,#genre#\nCCTV1,https://a/1.m3u8#https://b/1.m3u8\n\n卫视,#genre#\n东方卫视,http://d/2\n乱写的一行\n");
    expect(channels.map(c => [c.group, c.name, c.url])).toEqual([
      ["央视", "CCTV1", "https://a/1.m3u8"],
      ["央视", "CCTV1", "https://b/1.m3u8"],
      ["卫视", "东方卫视", "http://d/2"],
    ]);
  });
});

describe("live channels", () => {
  test("importing merges lines into channels, and again adds nothing", async () => {
    expect(await importM3u(db, PLAYLIST, { dryRun: true })).toEqual({ groups: 2, channels: 2, streams: 3, skipped: 0 });
    expect(await listGroups(db)).toEqual([]);
    expect(await importM3u(db, PLAYLIST)).toEqual({ groups: 2, channels: 2, streams: 3, skipped: 0 });
    expect(await importM3u(db, PLAYLIST)).toEqual({ groups: 0, channels: 0, streams: 0, skipped: 3 });
    const [cctv] = await listGroups(db);
    const channels = await listChannels(db, cctv!.id);
    expect(channels[0]!.streams.map(s => s.url)).toEqual(["https://a/cctv1.m3u8", "https://b/cctv1.m3u8"]);
    expect(await getEpg(db)).toEqual(["https://epg.example/e.xml"]);

    await importM3u(db, "#EXTM3U\n#EXTINF:-1 group-title=\"新\",新频道\nhttps://n/1\n", { replace: true });
    expect((await listGroups(db)).map(g => g.name)).toEqual(["新"]);
    await expect(importM3u(db, "nothing here")).rejects.toMatchObject({ code: "NOTHING_IMPORTED" });
  });

  test("export writes enabled channels back out, one entry per stream", async () => {
    await importM3u(db, PLAYLIST);
    const text = await exportM3u(db);
    expect(text.startsWith("#EXTM3U x-tvg-url=\"https://epg.example/e.xml\"")).toBe(true);
    const back = parseM3u(text);
    expect(back.channels.map(c => [c.group, c.name, c.url, c.userAgent])).toEqual([
      ["央视", "CCTV-1 综合", "https://a/cctv1.m3u8", null],
      ["央视", "CCTV-1 综合", "https://b/cctv1.m3u8", "okhttp"],
      ["卫视", "湖南卫视", "rtmp://c/hunan", null],
    ]);
    const hunan = (await listChannels(db, (await listGroups(db))[1]!.id))[0]!;
    await updateChannel(db, hunan.id, { enabled: false });
    expect(parseM3u(await exportM3u(db)).channels).toHaveLength(2);
  });

  test("channels own their streams; a group takes its channels along", async () => {
    const group = await createGroup(db, "测试");
    const ch = await createChannel(db, { groupId: group.id, name: "A", streams: [{ url: "https://a/1" }, { url: "https://a/2" }] });
    expect(ch.streams.map(s => s.sort)).toEqual([0, 1]);
    const updated = await updateChannel(db, ch.id, { streams: [{ url: "https://a/3" }] });
    expect(updated.streams.map(s => s.url)).toEqual(["https://a/3"]);
    await deleteGroup(db, group.id);
    expect(await listGroups(db)).toEqual([]);
    expect(parseM3u(await exportM3u(db)).channels).toEqual([]);
  });
});
