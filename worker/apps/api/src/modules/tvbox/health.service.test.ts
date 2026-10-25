import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDb } from "@/db";
import { nanoid } from "@/shared/lib/id";
import { applyHealth } from "./health.service";
import { createEntry, getEntry, setEntriesEnabled, updateEntry } from "./tvbox.service";

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = resolve(tmpdir(), `test-health-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  db = await createDb(resolve(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const site = (key: string) => createEntry(db, "sites", { key, name: key, type: 3, api: "csp_X" });

describe("applyHealth", () => {
  test("a failing entry is disabled, and enabled again once it passes", async () => {
    const e = await site("a");
    const first = await applyHealth(db, [{ id: e.id, status: "fail", detail: "https://a → 522" }]);
    expect(first).toMatchObject({ disabled: ["a"], enabled: [] });
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: false, disabledByHealth: true, healthStatus: "fail", healthDetail: "https://a → 522" });

    const second = await applyHealth(db, [{ id: e.id, status: "ok", detail: "https://a → 200" }]);
    expect(second).toMatchObject({ disabled: [], enabled: ["a"] });
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: true, disabledByHealth: false, healthStatus: "ok" });
  });

  test("turning a health-disabled entry back on by hand exempts it from checks", async () => {
    const e = await site("a");
    await applyHealth(db, [{ id: e.id, status: "fail", detail: "x" }]);
    const forced = await updateEntry(db, e.id, { enabled: true });
    expect(forced).toMatchObject({ enabled: true, healthExempt: true, disabledByHealth: false });

    const again = await applyHealth(db, [{ id: e.id, status: "fail", detail: "still down from CI" }]);
    expect(again.disabled).toEqual([]);
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: true, healthStatus: "fail", healthDetail: "still down from CI" });

    // Lifting the exemption hands it back to the checks.
    await updateEntry(db, e.id, { healthExempt: false });
    expect((await applyHealth(db, [{ id: e.id, status: "fail", detail: "x" }])).disabled).toEqual(["a"]);
  });

  test("an entry disabled by hand is never switched on", async () => {
    const e = await site("a");
    await updateEntry(db, e.id, { enabled: false });
    const r = await applyHealth(db, [{ id: e.id, status: "ok", detail: "fine" }]);
    expect(r.enabled).toEqual([]);
    expect((await getEntry(db, e.id)).enabled).toBe(false);
  });

  test("blocked and unchecked results only record; unknown ids are ignored", async () => {
    const e = await site("a");
    const r = await applyHealth(db, [
      { id: e.id, status: "blocked", detail: "https://a → 403" },
      { id: "gone", status: "fail", detail: "x" },
    ]);
    expect(r).toEqual({ recorded: 1, disabled: [], enabled: [] });
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: true, healthStatus: "blocked" });

    await applyHealth(db, [{ id: e.id, status: "skip", detail: "nothing to check" }]);
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: true, healthStatus: "skip" });
  });

  test("bulk enabling follows the same rule", async () => {
    const e = await site("a");
    await applyHealth(db, [{ id: e.id, status: "fail", detail: "x" }]);
    await setEntriesEnabled(db, [e.id], true);
    expect(await getEntry(db, e.id)).toMatchObject({ enabled: true, healthExempt: true, disabledByHealth: false });
  });
});
