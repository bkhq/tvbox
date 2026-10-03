import type { EnrollReport } from "./enroll.service";
import type { AppDatabase } from "@/db";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { createDevice, deleteDevice, getDevice, rotateDevice } from "./devices.service";
import { answerEnroll, approveEnrollment, linkedApps, listEnrollments, RE_ENROLL_CODE, rejectEnrollment } from "./enroll.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const ORIGIN = "https://tv.example";
const CODE = "K7Q2-9XMB";
const REPORT = { code: CODE, deviceId: "02:AB:CD:EF:01:23", name: "影视", model: "Xiaomi MiBOX4", mode: "leanback", abi: "arm64_v8a", versionCode: 10100, versionName: "1.1.0" };

let db: AppDatabase;
let dir: string;
let admin: string;

beforeEach(async () => {
  dir = resolve(tmpdir(), `test-enroll-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  db = await createDb(resolve(dir, "test.db"));
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  admin = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: admin, oauthSub: `sub-${admin}`, username: admin, name: admin, email: `${admin}@t.io`, role: "admin", status: "active", createdAt: now, updatedAt: now }).run();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ask = (report: EnrollReport = REPORT, ip = "203.0.113.7") => answerEnroll(db, "request", report, ip, ORIGIN);
const pendingId = async () => (await listEnrollments(db)).find(e => e.code === CODE)!.id;

describe("the app's side", () => {
  test("a new code waits for approval, and each check refreshes what the app reports", async () => {
    expect(await ask()).toEqual({ status: "pending" });
    expect(await ask({ ...REPORT, versionCode: 10200, versionName: "1.2.0" }, "203.0.113.8")).toEqual({ status: "pending" });
    const [e] = await listEnrollments(db);
    expect(e).toMatchObject({ code: CODE, status: "pending", model: "Xiaomi MiBOX4", versionName: "1.2.0", ip: "203.0.113.8", deviceRef: null });
  });

  test("a check that reports less keeps what an earlier one said", async () => {
    await ask();
    await ask({ code: CODE });
    expect((await listEnrollments(db))[0]).toMatchObject({ name: "影视", model: "Xiaomi MiBOX4", versionCode: 10100 });
  });

  test("once approved the app gets its device's subscription URL, and the new one after a rotation", async () => {
    await ask();
    const approved = await approveEnrollment(db, await pendingId(), { upstreamIds: null }, admin);
    const device = await getDevice(db, approved.deviceRef!);
    expect(device).toMatchObject({ name: "影视", note: "Xiaomi MiBOX4 · K7Q2-9XMB", allUpstreams: true });

    expect(await ask()).toEqual({ status: "approved", subscription: `${ORIGIN}/s/${device.token}/api.json` });
    const rotated = await rotateDevice(db, device.id);
    expect(await ask()).toEqual({ status: "approved", subscription: `${ORIGIN}/s/${rotated.token}/api.json` });
  });

  test("a request can be attached to an existing device", async () => {
    const existing = await createDevice(db, { name: "客厅电视", upstreamIds: [] }, admin);
    await ask();
    const approved = await approveEnrollment(db, await pendingId(), { deviceId: existing.id }, admin);
    expect(approved.deviceName).toBe("客厅电视");
    expect((await linkedApps(db)).get(existing.id)?.model).toBe("Xiaomi MiBOX4");
  });

  test("a rejected request, a revoked link and a deleted device all answer rejected", async () => {
    await ask();
    await rejectEnrollment(db, await pendingId());
    expect(await ask()).toEqual({ status: "rejected" });

    const other = { ...REPORT, code: "ABCD-2345" };
    await ask(other);
    const id = (await listEnrollments(db)).find(e => e.code === other.code)!.id;
    await approveEnrollment(db, id, {}, admin);
    await rejectEnrollment(db, id);
    expect(await ask(other)).toEqual({ status: "rejected" });

    const again = await approveEnrollment(db, id, {}, admin);
    expect((await ask(other)).status).toBe("approved");
    await deleteDevice(db, again.deviceRef!);
    expect(await ask(other)).toEqual({ status: "rejected" });
  });

  test("unlinking from the device ends the link and keeps the device", async () => {
    await ask();
    const approved = await approveEnrollment(db, await pendingId(), {}, admin);
    expect(await answerEnroll(db, "unlink", REPORT, "203.0.113.7", ORIGIN)).toEqual({ status: "rejected" });
    expect((await listEnrollments(db))[0]!.status).toBe("unlinked");
    expect(await getDevice(db, approved.deviceRef!)).toBeTruthy();
    await expect(approveEnrollment(db, await pendingId(), {}, admin)).rejects.toThrow("unlinked itself");
  });

  test("unanswered requests are capped", async () => {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 102; i++)
      await ask({ ...REPORT, code: `AAAA-AA${alphabet[Math.floor(i / alphabet.length)]}${alphabet[i % alphabet.length]}` });
    expect((await listEnrollments(db)).length).toBeLessThanOrEqual(100);
  });
});

describe("RE_ENROLL_CODE", () => {
  test("accepts the app's alphabet only", () => {
    expect(RE_ENROLL_CODE.test("K7Q2-9XMB")).toBe(true);
    for (const bad of ["K7Q2-9XM", "K7Q29XMB", "k7q2-9xmb", "IOL0-1XMB"])
      expect(RE_ENROLL_CODE.test(bad)).toBe(false);
  });
});
