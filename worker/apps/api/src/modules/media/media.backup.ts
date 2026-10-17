import type { BackupContribution, ExternalBackupDb } from "@/modules/backup/registry";
import { getMediaDb } from "./db";
import {
  mediaCategories,
  mediaCollections,
  mediaCredits,
  mediaEpisodes,
  mediaExternalIds,
  mediaGenres,
  mediaImages,
  mediaLiveChannels,
  mediaLiveGroups,
  mediaLiveStreams,
  mediaPeople,
  mediaRowItems,
  mediaRows,
  mediaSeasons,
  mediaSettings,
  mediaSources,
  mediaStreams,
  mediaTitleAliases,
  mediaTitleGenres,
  mediaTitles,
  mediaTitleTranslations,
} from "./schema";

// The source data only, from the media D1 database: the read model next to
// it is rebuilt by publishing, and uploaded images live in blob storage like
// the tvbox module's files.
export const mediaBackupContribution: BackupContribution = {
  name: "media",
  db: () => getMediaDb() as unknown as ExternalBackupDb | null,
  // Parents before children so every FK resolves on restore.
  tables: [
    mediaCategories,
    mediaGenres,
    mediaCollections,
    mediaTitles,
    mediaTitleAliases,
    mediaTitleTranslations,
    mediaTitleGenres,
    mediaSeasons,
    mediaEpisodes,
    mediaPeople,
    mediaCredits,
    mediaImages,
    mediaExternalIds,
    mediaSources,
    mediaStreams,
    mediaRows,
    mediaRowItems,
    mediaSettings,
    mediaLiveGroups,
    mediaLiveChannels,
    mediaLiveStreams,
  ],
  deps: [],
};
