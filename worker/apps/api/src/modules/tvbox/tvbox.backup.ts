import type { BackupContribution } from "@/modules/backup/registry";
import {
  tvboxAssets,
  tvboxDevices,
  tvboxDeviceUpstreams,
  tvboxEnrollments,
  tvboxEntries,
  tvboxGlobals,
  tvboxPublishes,
  tvboxReleaseAssets,
  tvboxReleases,
  tvboxUpstreams,
} from "./schema";

// Rows only: mirrored files, published configs and APKs live in blob storage,
// the same scope rule the file module follows.
export const tvboxBackupContribution: BackupContribution = {
  name: "tvbox",
  // Parents before children so every FK resolves on restore.
  tables: [
    tvboxUpstreams,
    tvboxEntries,
    tvboxGlobals,
    tvboxAssets,
    tvboxPublishes,
    tvboxDevices,
    tvboxDeviceUpstreams,
    tvboxEnrollments,
    tvboxReleases,
    tvboxReleaseAssets,
  ],
  deps: ["users"],
};
