import { describe, expect, it } from "vitest";
import { countsText, entrySubtitle, entryTitle, filterEntries, filterHealth, moveId, siteEngine, upstreamLabel, upstreamTree } from "./-tvbox-view";

describe("entryTitle / entrySubtitle", () => {
  it("prefers the name, then the key", () => {
    expect(entryTitle({ id: "1", upstreamKey: null, data: { name: "N", key: "k" } })).toBe("N");
    expect(entryTitle({ id: "1", upstreamKey: null, data: { key: "k" } })).toBe("k");
    expect(entryTitle({ id: "1", upstreamKey: "u", data: {} })).toBe("u");
    expect(entryTitle({ id: "1", upstreamKey: null, data: {} })).toBe("1");
  });

  it("describes a site by key and api, other entries by url or hosts", () => {
    expect(entrySubtitle({ kind: "sites", data: { key: "k", api: "csp_A" } })).toBe("k · csp_A");
    expect(entrySubtitle({ kind: "parses", data: { url: "https://p/" } })).toBe("https://p/");
    expect(entrySubtitle({ kind: "rules", data: { hosts: ["a", "b"] } })).toBe("a, b");
    expect(entrySubtitle({ kind: "rules", data: {} })).toBe("");
  });
});

describe("filterEntries", () => {
  const rows = [{ data: { name: "Bilibili" } }, { data: { name: "Douban", ext: "x" } }];
  it("matches anywhere in the JSON, ignoring case and surrounding space", () => {
    expect(filterEntries(rows, " BILI ")).toEqual([rows[0]]);
    expect(filterEntries(rows, "ext")).toEqual([rows[1]]);
    expect(filterEntries(rows, "")).toBe(rows);
  });
});

describe("moveId", () => {
  it("moves within bounds and refuses to leave the list", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b"], "a", -1)).toBeNull();
    expect(moveId(["a", "b"], "b", 1)).toBeNull();
    expect(moveId(["a"], "x", 1)).toBeNull();
  });
});

describe("countsText", () => {
  it("lists non-empty kinds", () => {
    expect(countsText("{\"sites\":103,\"parses\":9,\"rules\":0}")).toBe("sites 103 · parses 9");
  });
});

describe("filterHealth", () => {
  const rows = [
    { id: "a", healthStatus: "fail" as const, disabledByHealth: true, healthExempt: false },
    { id: "b", healthStatus: "fail" as const, disabledByHealth: false, healthExempt: true },
    { id: "c", healthStatus: "ok" as const, disabledByHealth: false, healthExempt: false },
  ];
  it("picks down, switched-off-by-check and forced-on entries", () => {
    expect(filterHealth(rows, "all")).toBe(rows);
    expect(filterHealth(rows, "fail").map(r => r.id)).toEqual(["a", "b"]);
    expect(filterHealth(rows, "disabledByHealth").map(r => r.id)).toEqual(["a"]);
    expect(filterHealth(rows, "exempt").map(r => r.id)).toEqual(["b"]);
  });
});

describe("upstreamTree / upstreamLabel", () => {
  const up = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId });
  const list = [up("a", "xiaosa"), up("c", "op"), up("l2", "Two", "c"), up("b", "a18"), up("l1", "One", "c")];

  it("puts a collection's lines right after it", () => {
    expect(upstreamTree(list).map(r => [r.upstream.id, r.depth, r.lines])).toEqual([
      ["a", 0, 0],
      ["c", 0, 2],
      ["l2", 1, 0],
      ["l1", 1, 0],
      ["b", 0, 0],
    ]);
  });

  it("names a line after its collection", () => {
    expect(upstreamLabel(list[2]!, list)).toBe("op / Two");
    expect(upstreamLabel(list[0]!, list)).toBe("xiaosa");
  });
});

describe("siteEngine", () => {
  it("tells CMS APIs from spiders by type and api", () => {
    expect(siteEngine({ type: 1, api: "https://c/api.php/provide/vod/" })).toBe("cmsJson");
    expect(siteEngine({ type: 0, api: "https://c/xml" })).toBe("cmsXml");
    expect(siteEngine({ type: 4, api: "https://c/" })).toBe("cmsJson");
    expect(siteEngine({ type: 3, api: "csp_Xx" })).toBe("jar");
    expect(siteEngine({ type: 3, api: "csp_MacCms", jar: "@tvbox" })).toBe("own");
    expect(siteEngine({ type: 3, api: "https://s/a.js" })).toBe("js");
    expect(siteEngine({ type: 3, api: "./py/a.py?x=1" })).toBe("python");
    expect(siteEngine({ type: 2 })).toBeNull();
  });
});
