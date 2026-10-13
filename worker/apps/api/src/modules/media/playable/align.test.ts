import { describe, expect, test } from "bun:test";
import { alignLines, episodeNumberOf, formatOf, parsePasted } from "./align";

const eps = (...numbers: number[]) => numbers.map(n => ({ id: `e${n}`, episodeNumber: n }));
const line = (name: string, n = name) => ({ name, url: `https://v.example/${n}.m3u8` });

describe("parsePasted", () => {
  test("takes newline and # separated name$url items, and bare urls", () => {
    expect(parsePasted("第1集$https://a/1.m3u8#第2集$https://a/2.m3u8\n\nhttps://a/3.m3u8\r\n")).toEqual([
      { name: "第1集", url: "https://a/1.m3u8" },
      { name: "第2集", url: "https://a/2.m3u8" },
      { name: "", url: "https://a/3.m3u8" },
    ]);
  });

  test("drops items without an http(s) url", () => {
    expect(parsePasted("第1集$ftp://a/1\n第2集$\nhello")).toEqual([]);
  });

  test("splits on the last $ so names may contain one", () => {
    expect(parsePasted("$5 promo$https://a/p.mp4")).toEqual([{ name: "$5 promo", url: "https://a/p.mp4" }]);
  });
});

describe("episodeNumberOf", () => {
  test.each([
    ["第3集", 3],
    ["第 12 话", 12],
    ["S01E07", 7],
    ["EP09", 9],
    ["e10", 10],
    ["03", 3],
    ["3集", 3],
    ["第8集 大结局", 8],
  ])("%s → %d", (name, n) => {
    expect(episodeNumberOf(name)).toBe(n);
  });

  test.each(["正片", "1080P 高清版", "HD中字", ""])("%s has none", (name) => {
    expect(episodeNumberOf(name)).toBeNull();
  });
});

describe("alignLines", () => {
  test("by number, whatever the order", () => {
    const result = alignLines([line("第2集"), line("第1集")], eps(1, 2));
    expect(result.matched.map(m => [m.episodeId, m.line.name])).toEqual([["e2", "第2集"], ["e1", "第1集"]]);
    expect(result.missing).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  test("reports numbers the season lacks as missing", () => {
    const result = alignLines([line("第1集"), line("第3集")], eps(1, 2));
    expect(result.matched.map(m => m.episodeNumber)).toEqual([1]);
    expect(result.missing.map(m => m.episodeNumber)).toEqual([3]);
  });

  test("by position when no line has a number", () => {
    const result = alignLines([line("正片A"), line("正片B"), line("正片C")], eps(5, 4));
    expect(result.matched.map(m => [m.episodeNumber, m.line.name])).toEqual([[4, "正片A"], [5, "正片B"]]);
    expect(result.unmatched).toEqual([{ line: line("正片C"), reason: "no-episode" }]);
  });

  test("a mix places the numbered lines and reports the rest; repeats are dropped", () => {
    const result = alignLines([line("第1集"), line("花絮"), line("第1集", "dup")], eps(1, 2));
    expect(result.matched.map(m => m.episodeNumber)).toEqual([1]);
    expect(result.unmatched.map(u => u.reason)).toEqual(["no-number", "duplicate"]);
  });

  test("specials number from 0", () => {
    const result = alignLines([line("第0集")], eps(0, 1));
    expect(result.matched[0]!.episodeId).toBe("e0");
  });
});

describe("formatOf", () => {
  test.each([
    ["https://a/x.m3u8", "hls"],
    ["https://a/x.mp4?t=1", "mp4"],
    ["https://a/x.MKV", "mp4"],
    ["https://a/x.mpd", "dash"],
    ["https://a/play?id=1", "hls"],
  ])("%s → %s", (url, format) => {
    expect(formatOf(url)).toBe(format as never);
  });
});
