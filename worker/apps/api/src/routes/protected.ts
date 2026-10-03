import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { accountRoutes } from "@/modules/account";
import { auditRoutes } from "@/modules/audit";
import { backupRoutes } from "@/modules/backup";
import { fileRoutes } from "@/modules/file";
import { settingsRoutes } from "@/modules/settings";
import { enrollRoutes, releaseRoutes, tvboxRoutes } from "@/modules/tvbox";

export function protectedRoutes() {
  const app = new Hono<AppEnv>();

  app.route("/", accountRoutes());
  app.route("/", settingsRoutes());
  app.route("/", auditRoutes());
  app.route("/", backupRoutes());
  app.route("/", fileRoutes());
  app.route("/", tvboxRoutes());
  app.route("/", releaseRoutes());
  app.route("/", enrollRoutes());

  return app;
}
