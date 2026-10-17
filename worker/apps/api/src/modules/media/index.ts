import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { registerBackupContribution } from "@/modules/backup/registry";
import { registerTokenScope } from "@/shared/lib/token-scopes";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { artworkRoutes } from "./artwork/artwork.routes";
import { catalogRoutes } from "./catalog/catalog.routes";
import { getMediaDb } from "./db";
import { importRoutes } from "./import/import.routes";
import { liveRoutes } from "./live/live.routes";
import { mediaBackupContribution } from "./media.backup";
import { peopleRoutes } from "./people/people.routes";
import { playableRoutes } from "./playable/playable.routes";
import { readModelRoutes } from "./readmodel/readmodel.routes";
import { rowsRoutes } from "./taxonomy/rows.routes";
import { taxonomyRoutes } from "./taxonomy/taxonomy.routes";
import { seedTaxonomy } from "./taxonomy/taxonomy.service";

registerBackupContribution(mediaBackupContribution);

/** Boot-time setup: the default categories and genres on a fresh media database, where there is one. */
export async function initMedia(): Promise<void> {
  const db = getMediaDb();
  if (db)
    await seedTaxonomy(db);
}

/** The admin API of the media library, admin only throughout. */
export function mediaRoutes() {
  const router = new Hono<AppEnv>();
  router.use("/media/*", authRequired, adminRequired);
  router.route("/", taxonomyRoutes());
  router.route("/", catalogRoutes());
  router.route("/", artworkRoutes());
  router.route("/", peopleRoutes());
  router.route("/", playableRoutes());
  router.route("/", rowsRoutes());
  router.route("/", liveRoutes());
  router.route("/", readModelRoutes());
  router.route("/", importRoutes());
  return router;
}

registerTokenScope({
  name: "media:read",
  description: "Read the media library",
  routes: [{ method: "GET", path: "/media/*" }],
});
registerTokenScope({
  name: "media:write",
  description: "Manage the media library",
  routes: (["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(method => ({ method, path: "/media/*" })),
});
