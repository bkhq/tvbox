import { registerBackupContribution } from "@/modules/backup/registry";
import { tvboxBackupContribution } from "./tvbox.backup";

export { releaseRawRoutes, releaseRoutes } from "./release.routes";
export { startTvboxSync, stopTvboxSync } from "./sync.job";
export { tvboxRoutes } from "./tvbox.routes";

registerBackupContribution(tvboxBackupContribution);
