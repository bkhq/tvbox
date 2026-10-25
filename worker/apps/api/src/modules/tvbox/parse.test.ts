import { describe, expect, test } from "bun:test";
import { collectAssetUrls, decodeUpstream, entryIdentity, resolveRelative, rewriteAssets, splitJarSpec } from "./parse";

const BASE = "https://raw.example/qist/tvbox/master/xiaosa/api.json";

describe("decodeUpstream", () => {
  test("plain JSON", () => {
    expect(decodeUpstream("{\"sites\":[]}")).toEqual({ sites: [] });
  });

  test("JSON with whole-line // comments", () => {
    expect(decodeUpstream("{\n// a comment\n\"sites\": []\n}")).toEqual({ sites: [] });
  });

  test("a payload hidden after an image behind an 8-char marker", () => {
    const json = "{\r\n\"spider\":\"./s.jar\",\r\n//c\r\n\"sites\":[]}";
    const text = `\xFF\xD8\xFF\xE0JFIF....\xFF\xD9abcd1234**${btoa(json)}`;
    expect(decodeUpstream(text)).toEqual({ spider: "./s.jar", sites: [] });
  });

  test("anything else is refused", () => {
    expect(() => decodeUpstream("<html>nope</html>")).toThrow();
    expect(() => decodeUpstream("[1,2]")).toThrow();
  });
});

describe("resolveRelative", () => {
  test("rewrites ./ and ../ strings anywhere in the tree against the upstream URL", () => {
    const out = resolveRelative({
      spider: "./spider.jar;md5;abc",
      sites: [
        {
          key: "a",
          ext: { json: "./json/A.json", cookie: "http://127.0.0.1:9978/file/x" },
        },
      ],
      logo: "../logo.png",
      plain: "text ./ inside",
    }, BASE);
    expect(out).toEqual({
      spider: "https://raw.example/qist/tvbox/master/xiaosa/spider.jar;md5;abc",
      sites: [
        {
          key: "a",
          ext: { json: "https://raw.example/qist/tvbox/master/xiaosa/json/A.json", cookie: "http://127.0.0.1:9978/file/x" },
        },
      ],
      logo: "https://raw.example/qist/tvbox/master/logo.png",
      plain: "text ./ inside",
    });
  });
});

describe("splitJarSpec", () => {
  test("separates the URL from an md5 suffix", () => {
    expect(splitJarSpec("https://x/s.jar;md5;abc")).toEqual({ url: "https://x/s.jar", md5: "abc" });
    expect(splitJarSpec("https://x/s.jar")).toEqual({ url: "https://x/s.jar" });
  });
});

describe("entryIdentity", () => {
  test("sites by key, the other lists by name, unnamed entries by content", () => {
    expect(entryIdentity("sites", { key: "k", name: "n" })).toBe("k");
    expect(entryIdentity("parses", { name: "n" })).toBe("n");
    expect(entryIdentity("rules", {
      hosts: ["a"],
    })).toBe("{\"hosts\":[\"a\"]}");
  });
});

describe("collectAssetUrls", () => {
  test("mirrors the spider and site jars wherever they live, other files only under the upstream directory", () => {
    const config = resolveRelative({
      spider: "https://cdn.other/jar.jpg;md5;x",
      sites: [
        {
          key: "a",
          jar: "./b.jar;md5;y",
          ext: { json: "./json/A.json" },
        },
        { key: "b", api: "https://other.example/drpy2.min.js", ext: "https://other.example/x.json" },
      ],
      lives: [
        { name: "l", url: "./lives/l.m3u" },
      ],
    }, BASE) as Record<string, unknown>;
    expect([
      ...collectAssetUrls(config, BASE),
    ].sort()).toEqual([
      "https://cdn.other/jar.jpg",
      "https://raw.example/qist/tvbox/master/xiaosa/b.jar",
      "https://raw.example/qist/tvbox/master/xiaosa/json/A.json",
      "https://raw.example/qist/tvbox/master/xiaosa/lives/l.m3u",
    ]);
  });
});

describe("rewriteAssets", () => {
  test("points mirrored URLs at ./a/<sha256>/<name> and recomputes jar md5", () => {
    const mirrored = new Map([
      [
        "https://cdn.other/jar.jpg",
        {
          sha256: "a".repeat(64),
          md5: "m1",
          name: "jar.jpg",
        },
      ],
      [
        "https://raw.example/x/json/A.json",
        {
          sha256: "b".repeat(64),
          md5: "m2",
          name: "A.json",
        },
      ],
    ]);
    const out = rewriteAssets({
      spider: "https://cdn.other/jar.jpg;md5;stale",
      sites: [
        {
          key: "a",
          jar: "https://cdn.other/jar.jpg",
          ext: { json: "https://raw.example/x/json/A.json" },
        },
      ],
      untouched: "https://raw.example/x/json/B.json",
    }, mirrored);
    expect(out).toEqual({
      spider: `./a/${"a".repeat(64)}/jar.jpg;md5;m1`,
      sites: [
        {
          key: "a",
          jar: `./a/${"a".repeat(64)}/jar.jpg;md5;m1`,
          ext: { json: `./a/${"b".repeat(64)}/A.json` },
        },
      ],
      untouched: "https://raw.example/x/json/B.json",
    });
  });
});
