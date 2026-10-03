import type { AppDatabase } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { tvboxEntries } from "./schema";

export type HealthStatus = "ok" | "blocked" | "fail" | "skip";

export interface HealthResult {
  readonly id: string;
  readonly status: HealthStatus;
  readonly detail: string;
}

export interface HealthOutcome {
  readonly recorded: number;
  /** Names switched off because they failed. */
  readonly disabled: readonly string[];
  /** Names switched back on because they passed again. */
  readonly enabled: readonly string[];
}

/**
 * Record a health run and act on it, check results first:
 *   - fail: an enabled entry is disabled and flagged as disabled by health;
 *   - ok / blocked: an entry health disabled is enabled again;
 *   - skip: recorded only.
 * Entries an admin forced on (`healthExempt`) and entries an admin switched
 * off are only recorded.
 */
export async function applyHealth(db: AppDatabase, results: readonly HealthResult[]): Promise<HealthOutcome> {
  const ids = [...new Set(results.map(r => r.id))];
  if (ids.length === 0)
    return { recorded: 0, disabled: [], enabled: [] };
  const rows = new Map((await db.select().from(tvboxEntries).where(inArray(tvboxEntries.id, ids)).all()).map(r => [r.id, r]));
  const now = new Date().toISOString();
  const disabled: string[] = [];
  const enabled: string[] = [];
  let recorded = 0;

  await db.transaction(async (tx) => {
    for (const result of results) {
      const row = rows.get(result.id);
      if (!row)
        continue;
      recorded++;
      const name = String((JSON.parse(row.data) as { name?: unknown; key?: unknown }).name ?? row.upstreamKey ?? row.id);
      let change = {};
      if (!row.healthExempt && result.status === "fail" && row.enabled) {
        change = { enabled: false, disabledByHealth: true };
        disabled.push(name);
      }
      else if (!row.healthExempt && (result.status === "ok" || result.status === "blocked") && row.disabledByHealth) {
        change = { enabled: true, disabledByHealth: false };
        enabled.push(name);
      }
      await tx.update(tvboxEntries).set({
        healthStatus: result.status,
        healthDetail: result.detail.slice(0, 1000),
        healthCheckedAt: now,
        ...change,
      }).where(eq(tvboxEntries.id, row.id)).run();
    }
  });
  return { recorded, disabled, enabled };
}
