import { DOH_PATH } from "./doh";
import { SUBSCRIPTION_PREFIX } from "./subscription";
import { UPDATES_PREFIX } from "./updates";

/**
 * Where the Worker sends a request:
 *
 *   landing       `/`, the public download page
 *   subscription  `/s/…`, TVBox configs from R2
 *   updates       `/u/…`, app updates from R2
 *   doh           `/dns-query`, DNS-over-HTTPS forwarded to Cloudflare
 *   app           `${base}/api…`, the Durable Object
 *   enroll        `/api/raw/tvbox/enroll`, the app's link endpoint, passed
 *                 to the Durable Object under the base path so the app never
 *                 learns where the console lives
 *   console       the rest of `${base}/…`, the admin SPA's assets
 *   redirect      `${base}` without its trailing slash
 *   missing       anything else
 */
export type Route = "landing" | "subscription" | "updates" | "doh" | "app" | "enroll" | "console" | "redirect" | "missing";

/** The one API path served at the site root. */
export const ENROLL_PATH = "/api/raw/tvbox/enroll";

/** Same normalisation as the app's BASE_PATH: "mg", "/mg" and "/mg/" are "/mg". */
export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

export function routeRequest(pathname: string, base: string): Route {
  if (pathname === "/")
    return "landing";
  if (pathname.startsWith(SUBSCRIPTION_PREFIX))
    return "subscription";
  if (pathname.startsWith(UPDATES_PREFIX))
    return "updates";
  if (pathname === DOH_PATH)
    return "doh";
  if (pathname === `${base}/api` || pathname.startsWith(`${base}/api/`))
    return "app";
  if (pathname === ENROLL_PATH)
    return "enroll";
  if (base === "")
    return "console";
  if (pathname === base)
    return "redirect";
  return pathname.startsWith(`${base}/`) ? "console" : "missing";
}
