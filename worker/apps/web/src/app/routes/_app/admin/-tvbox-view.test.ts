import { describe, expect, it } from "vitest";
import { countsText, entrySubtitle, entryTitle, filterEntries, filterHealth, moveId } from "./-tvbox-view";

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
