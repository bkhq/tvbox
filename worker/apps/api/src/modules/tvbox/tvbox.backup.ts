import type { BackupContribution } from "@/modules/backup/registry";
import { tvboxAssets, tvboxEntries, tvboxGlobals, tvboxPublishes, tvboxReleaseAssets, tvboxReleases, tvboxTokens, tvboxUpstreams } from "./schema";

// Rows only: mirrored files, published configs and APKs live in blob storage,
// the same scope rule the file module follows.
export const tvboxBackupContribution: BackupContribution = {
  name: "tvbox",
  // `tvbox_upstreams` first so the FK on `tvbox_entries.upstream_id` resolves.
  tables: [tvboxUpstreams, tvboxEntries, tvboxGlobals, tvboxAssets, tvboxPublishes, tvboxTokens, tvboxReleases, tvboxReleaseAssets],
  deps: ["users"],
};
