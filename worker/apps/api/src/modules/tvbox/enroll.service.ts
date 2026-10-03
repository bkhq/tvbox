import type { AppDatabase } from "@/db";
import { desc, eq, inArray } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { createDevice, getDevice } from "./devices.service";
import { tvboxDevices, tvboxEnrollments } from "./schema";

/** The app's code alphabet (no I, L, O, 0, 1), as `XXXX-XXXX`. */
export const RE_ENROLL_CODE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

// Anyone can ask to be linked, so unanswered requests are capped; the oldest
// beyond this are dropped.
const MAX_PENDING = 100;

export type EnrollmentRow = typeof tvboxEnrollments.$inferSelect;

export interface EnrollReport {
  readonly code: string;
  readonly deviceId?: string | undefined;
  readonly name?: string | undefined;
  readonly model?: string | undefined;
  readonly mode?: string | undefined;
  readonly abi?: string | undefined;
  readonly versionCode?: number | undefined;
  readonly versionName?: string | undefined;
}

export type EnrollAnswer
  = | { readonly status: "pending" }
    | { readonly status: "approved"; readonly subscription: string }
    | { readonly status: "rejected" };

/** What this check reported; fields it left out keep their earlier value. */
function reported(report: EnrollReport, ip: string): Partial<typeof tvboxEnrollments.$inferInsert> {
  const fields: Partial<typeof tvboxEnrollments.$inferInsert> = { ip: ip.slice(0, 64), lastSeenAt: new Date().toISOString() };
  const strings = { appDeviceId: report.deviceId, name: report.name, model: report.model, mode: report.mode, abi: report.abi, versionName: report.versionName };
  for (const [key, value] of Object.entries(strings) as [keyof typeof strings, string | undefined][]) {
    if (value !== undefined)
      fields[key] = value.slice(0, 100);
  }
  if (report.versionCode !== undefined)
    fields.versionCode = report.versionCode;
  return fields;
}

async function prunePending(db: AppDatabase): Promise<void> {
  const pending = await db.select({ id: tvboxEnrollments.id }).from(tvboxEnrollments).where(eq(tvboxEnrollments.status, "pending")).orderBy(desc(tvboxEnrollments.lastSeenAt)).all();
  const stale = pending.slice(MAX_PENDING).map(r => r.id);
  if (stale.length > 0)
    await db.delete(tvboxEnrollments).where(inArray(tvboxEnrollments.id, stale)).run();
}

/**
 * The app's side of linking (`POST /api/raw/tvbox/enroll`). `request` records
 * or refreshes the code and answers with its state; once approved it carries
 * the linked device's subscription URL, built on `origin`. `unlink` ends the
 * link from the device; the device and its subscription stay for the admin.
 */
export async function answerEnroll(
  db: AppDatabase,
  action: "request" | "unlink",
  report: EnrollReport,
  ip: string,
  origin: string,
): Promise<EnrollAnswer> {
  const row = await db.select().from(tvboxEnrollments).where(eq(tvboxEnrollments.code, report.code)).get();

  if (action === "unlink") {
    if (row?.status === "approved" || row?.status === "pending") {
      await db.update(tvboxEnrollments)
        .set({ ...reported(report, ip), status: "unlinked", resolvedAt: new Date().toISOString() })
        .where(eq(tvboxEnrollments.id, row.id))
        .run();
    }
    return { status: "rejected" };
  }

  if (!row) {
    await db.insert(tvboxEnrollments).values({ id: ulid(), code: report.code, ...reported(report, ip) }).run();
    await prunePending(db);
    return { status: "pending" };
  }

  await db.update(tvboxEnrollments).set(reported(report, ip)).where(eq(tvboxEnrollments.id, row.id)).run();
  if (row.status === "pending")
    return { status: "pending" };
  if (row.status !== "approved" || row.deviceRef === null)
    return { status: "rejected" };

  const device = await db.select().from(tvboxDevices).where(eq(tvboxDevices.id, row.deviceRef)).get();
  if (!device?.token)
    return { status: "rejected" };
  return { status: "approved", subscription: `${origin}/s/${device.token}/api.json` };
}

export interface EnrollmentView extends EnrollmentRow {
  readonly deviceName: string | null;
}

/** Pending requests first, then the rest, newest first. */
export async function listEnrollments(db: AppDatabase): Promise<EnrollmentView[]> {
  const rows = await db.select().from(tvboxEnrollments).orderBy(desc(tvboxEnrollments.lastSeenAt)).all();
  const devices = await db.select({ id: tvboxDevices.id, name: tvboxDevices.name }).from(tvboxDevices).all();
  return rows
    .map(r => ({ ...r, deviceName: devices.find(d => d.id === r.deviceRef)?.name ?? null }))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
}

async function getEnrollment(db: AppDatabase, id: string): Promise<EnrollmentRow> {
  const row = await db.select().from(tvboxEnrollments).where(eq(tvboxEnrollments.id, id)).get();
  if (!row)
    throw new NotFoundError("Enrollment");
  return row;
}

export interface ApproveInput {
  /** Attach to this existing device instead of creating one. */
  readonly deviceId?: string | undefined;
  readonly name?: string | undefined;
  /** For a new device: null follows every upstream. */
  readonly upstreamIds?: readonly string[] | null | undefined;
}

/** Link a request to a device (a new one unless `deviceId` is given); the app picks it up on its next check. */
export async function approveEnrollment(db: AppDatabase, id: string, input: ApproveInput, userId: string): Promise<EnrollmentView> {
  const row = await getEnrollment(db, id);
  if (row.status === "unlinked")
    throw new AppError("The device unlinked itself; it will ask again with a new code", 409, "ENROLLMENT_UNLINKED");

  const deviceId = input.deviceId
    ? (await getDevice(db, input.deviceId)).id
    : (await createDevice(db, {
        name: input.name?.trim() || row.name || row.model || row.code,
        note: [row.model, row.code].filter(Boolean).join(" · "),
        upstreamIds: input.upstreamIds ?? null,
      }, userId)).id;

  await db.update(tvboxEnrollments)
    .set({ status: "approved", deviceRef: deviceId, resolvedAt: new Date().toISOString() })
    .where(eq(tvboxEnrollments.id, id))
    .run();
  return (await listEnrollments(db)).find(e => e.id === id)!;
}

/** Refuse a request, or revoke an approved link: the app turns its link off on its next check. */
export async function rejectEnrollment(db: AppDatabase, id: string): Promise<EnrollmentView> {
  await getEnrollment(db, id);
  await db.update(tvboxEnrollments)
    .set({ status: "rejected", resolvedAt: new Date().toISOString() })
    .where(eq(tvboxEnrollments.id, id))
    .run();
  return (await listEnrollments(db)).find(e => e.id === id)!;
}

export async function deleteEnrollment(db: AppDatabase, id: string): Promise<EnrollmentRow> {
  const row = await getEnrollment(db, id);
  await db.delete(tvboxEnrollments).where(eq(tvboxEnrollments.id, id)).run();
  return row;
}

/** The most recently seen app linked to each device, for the device list. */
export async function linkedApps(db: AppDatabase): Promise<Map<string, EnrollmentRow>> {
  const rows = await db.select().from(tvboxEnrollments).where(eq(tvboxEnrollments.status, "approved")).orderBy(desc(tvboxEnrollments.lastSeenAt)).all();
  const byDevice = new Map<string, EnrollmentRow>();
  for (const row of rows) {
    if (row.deviceRef && !byDevice.has(row.deviceRef))
      byDevice.set(row.deviceRef, row);
  }
  return byDevice;
}
