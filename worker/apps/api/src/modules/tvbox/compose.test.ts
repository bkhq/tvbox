import type { ComposeEntry } from "./compose";
import { describe, expect, test } from "bun:test";
import { compose, composeForDevice } from "./compose";

function entry(over: Partial<ComposeEntry> & Pick<ComposeEntry, "kind" | "data">): ComposeEntry {
  return {
    id: over.data.key as string ?? over.data.name as string ?? "x",
    upstreamId: "up1",
    enabled: true,
    sort: 0,
    ...over,
  };
}

describe("compose", () => {
  test("lays out head globals, then the lists, then the remaining globals", () => {
    const out = compose({
      globals: [
        {
          key: "flags",
          value: ["qq"],
        },
        { key: "spider", value: "./a/s/spider.jar;md5;1" },
        { key: "logo", value: "https://logo" },
      ],
      entries: [
        entry({
          kind: "parses",
          data: { name: "p", type: 0, url: "u" },
        }),
        entry({
          kind: "sites",
          data: {
            key: "s",
            name: "S",
            type: 3,
            api: "csp_S",
          },
        }),
      ],
    });
    expect(Object.keys(out)).toEqual([
      "spider",
      "logo",
      "sites",
      "parses",
      "flags",
    ]);
    expect(out.sites).toEqual([
      {
        key: "s",
        name: "S",
        type: 3,
        api: "csp_S",
      },
    ]);
  });

  test("drops disabled entries and orders by sort", () => {
    const out = compose({
      globals: [],
      entries: [
        entry({
          id: "1",
          kind: "sites",
          sort: 2,
          data: { key: "b" },
        }),
        entry({
          id: "2",
          kind: "sites",
          sort: 1,
          data: { key: "a" },
        }),
        entry({
          id: "3",
          kind: "sites",
          sort: 0,
          enabled: false,
          data: { key: "off" },
        }),
      ],
    });
    expect((out.sites as { key: string }[]).map(s => s.key)).toEqual(["a", "b"]);
  });

  test("keeps site keys unique: a later duplicate is suffixed with its upstream", () => {
    const out = compose({
      globals: [],
      entries: [
        entry({
          id: "1",
          kind: "sites",
          sort: 0,
          upstreamId: "primary",
          data: { key: "k" },
        }),
        entry({
          id: "2",
          kind: "sites",
          sort: 1,
          upstreamId: "secondary9",
          data: { key: "k" },
        }),
      ],
    });
    expect((out.sites as { key: string }[]).map(s => s.key)).toEqual(["k", "k_second"]);
  });

  test("opens on a site with content: a leading non-searchable site moves behind the first searchable one", () => {
    const out = compose({
      globals: [],
      entries: [
        entry({
          id: "1",
          kind: "sites",
          sort: 0,
          data: { key: "search", searchable: 0 },
        }),
        entry({
          id: "2",
          kind: "sites",
          sort: 1,
          data: { key: "config", searchable: "0" },
        }),
        entry({
          id: "3",
          kind: "sites",
          sort: 2,
          data: { key: "cms", searchable: 1 },
        }),
        entry({
          id: "4",
          kind: "sites",
          sort: 3,
          data: { key: "spider" },
        }),
      ],
    });
    expect((out.sites as { key: string }[]).map(s => s.key)).toEqual(["cms", "search", "config", "spider"]);
  });

  test("keeps the order when no site is searchable", () => {
    const out = compose({
      globals: [],
      entries: [
        entry({
          id: "1",
          kind: "sites",
          sort: 0,
          data: { key: "a", searchable: 0 },
        }),
        entry({
          id: "2",
          kind: "sites",
          sort: 1,
          data: { key: "b", searchable: 0 },
        }),
      ],
    });
    expect((out.sites as { key: string }[]).map(s => s.key)).toEqual(["a", "b"]);
  });

  test("omits empty lists", () => {
    expect(compose({ globals: [], entries: [] })).toEqual({});
  });
});

describe("composeForDevice", () => {
  const snapshot = {
    version: 2 as const,
    globals: [
      { key: "spider", value: "./s.jar" },
    ],
    entries: [
      entry({
        id: "1",
        kind: "sites",
        sort: 0,
        upstreamId: "up-a",
        data: { key: "a" },
      }),
      entry({
        id: "2",
        kind: "sites",
        sort: 1,
        upstreamId: "up-b",
        data: { key: "b" },
      }),
      entry({
        id: "3",
        kind: "sites",
        sort: 2,
        upstreamId: null,
        data: { key: "common" },
      }),
    ],
  };
  const keys = (out: Record<string, unknown>) => (out.sites as { key: string }[]).map(s => s.key);

  test("a device on every upstream gets everything", () => {
    expect(keys(composeForDevice(snapshot, null))).toEqual(["a", "b", "common"]);
  });

  test("a device on some upstreams gets those plus the common entries", () => {
    expect(keys(composeForDevice(snapshot, ["up-b"]))).toEqual(["b", "common"]);
    expect(keys(composeForDevice(snapshot, []))).toEqual(["common"]);
  });

  test("globals are shared", () => {
    expect(composeForDevice(snapshot, []).spider).toBe("./s.jar");
  });
});
