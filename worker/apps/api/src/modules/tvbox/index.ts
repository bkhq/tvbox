import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { registerBackupContribution } from "@/modules/backup/registry";
import { registerTokenScope } from "@/shared/lib/token-scopes";
import { writeDevicesFile } from "./devices.service";
import { startTvboxSync } from "./sync.job";
import { tvboxBackupContribution } from "./tvbox.backup";

export { enrollRawRoutes, enrollRoutes } from "./enroll.routes";
export { releaseRawRoutes, releaseRoutes } from "./release.routes";
export { stopTvboxSync } from "./sync.job";
export { tvboxRoutes } from "./tvbox.routes";

registerBackupContribution(tvboxBackupContribution);

/**
 * Boot-time setup: rewrite the devices file (rows migrated from plain tokens
 * have none yet) and start the scheduled sync.
 */
export async function initTvbox(db: AppDatabase, config: Config, logger: Logger): Promise<void> {
  try {
    await writeDevicesFile(db);
  }
  catch (err) {
    logger.warn({ err }, "tvbox: could not write the devices file");
  }
  startTvboxSync(db, config, logger);
}

// API tokens act as their (admin) owner on these routes only; CI uses
// `tvbox:write` to manage upstreams, sync and publish.
registerTokenScope({
  name: "tvbox:read",
  description: "Read TVBox upstreams, entries, publishes and releases",
  routes: [
    { method: "GET", path: "/tvbox/*" },
  ],
});
registerTokenScope({
  name: "tvbox:write",
  description: "Manage TVBox upstreams, entries, publishing, subscriptions and releases",
  routes: ([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ] as const).map(method => ({ method, path: "/tvbox/*" })),
});
