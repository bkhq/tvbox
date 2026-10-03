import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { ScheduledHandle } from "@/platform";
import type { Logger } from "@/shared/lib/logger";
import { getPlatform } from "@/platform";
import { publish } from "./publish.service";
import { changeCount, listSyncableUpstreams, syncUpstream } from "./sync.service";

const FIRST_RUN_DELAY_MS = 60_000;

let task: ScheduledHandle | undefined;

/** One pass over every sync-enabled upstream; publishes when anything changed. */
export async function runScheduledSync(db: AppDatabase, logger: Logger, fetchImpl?: typeof fetch): Promise<number> {
  let changed = 0;
  for (const upstream of await listSyncableUpstreams(db)) {
    try {
      changed += changeCount(await syncUpstream(db, upstream.id, { logger, ...(fetchImpl ? { fetch: fetchImpl } : {}) }));
    }
    catch (err) {
      logger.error({ err, upstream: upstream.name }, "tvbox: scheduled sync failed");
    }
  }
  if (changed > 0) {
    await publish(db, { trigger: "sync" });
    logger.info({ changed }, "tvbox: scheduled sync published");
  }
  return changed;
}

export function startTvboxSync(db: AppDatabase, config: Config, logger: Logger): void {
  if (task || config.TVBOX_SYNC_INTERVAL_MINUTES <= 0)
    return;
  const intervalMs = config.TVBOX_SYNC_INTERVAL_MINUTES * 60_000;
  task = getPlatform().scheduler.every("tvbox-sync", { delayMs: FIRST_RUN_DELAY_MS, intervalMs }, async () => {
    await runScheduledSync(db, logger);
  });
}

export async function stopTvboxSync(): Promise<void> {
  const t = task;
  task = undefined;
  await t?.stop();
}
