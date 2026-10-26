import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { mediaTitles } from "../schema";

/**
 * What one client reads: the published library, limited to public titles and
 * the titles of the client's channels, as of `today` (UTC) for air dates.
 */
export interface Audience {
  readonly channels: readonly string[];
  readonly today: string;
}

/** `title` (an id column or alias) is public or in one of `channels`. */
export function seenBy(channels: readonly string[], title: SQL, isPublic: SQL): SQL {
  if (channels.length === 0)
    return sql`${isPublic} = 1`;
  return sql`(${isPublic} = 1 OR EXISTS (SELECT 1 FROM media_title_channels tc WHERE tc.title_id = ${title} AND tc.channel_id IN ${channels}))`;
}

/** For queries over `media_titles` built with drizzle. */
export function titleSeenBy(channels: readonly string[]): SQL {
  return seenBy(channels, sql`${mediaTitles.id}`, sql`${mediaTitles.public}`);
}
