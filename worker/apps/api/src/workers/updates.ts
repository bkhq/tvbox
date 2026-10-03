import type { SubscriptionEnv } from "./subscription";
import { releaseApkKey, updateManifestKey } from "@/modules/tvbox/storage";

/**
 * App update endpoints, public and answered by the stateless Worker from the
 * objects the tvbox release module writes:
 *
 *   /u/<channel>/<mode>-<abi>.json        newest release for that flavor
 *   /u/apk/<versionCode>/<mode>-<abi>.apk  the APK a manifest points at
 */

export const UPDATES_PREFIX = "/u/";

const RE_MANIFEST = /^\/u\/(stable|beta)\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.json$/;
const RE_APK = /^\/u\/apk\/(\d{1,10})\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.apk$/;

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

export async function handleUpdates(request: Request, env: SubscriptionEnv): Promise<Response> {
  const bucket = env.FILES;
  if (!bucket)
    return notFound();
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });

  const { pathname } = new URL(request.url);
  const manifest = RE_MANIFEST.exec(pathname);
  if (manifest) {
    const object = await bucket.get(updateManifestKey(manifest[1]!, manifest[2]!, manifest[3]!));
    if (!object)
      return notFound();
    return new Response(object.body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  const apk = RE_APK.exec(pathname);
  if (apk) {
    const object = await bucket.get(releaseApkKey(Number(apk[1]), apk[2]!, apk[3]!));
    if (!object)
      return notFound();
    return new Response(object.body, {
      headers: {
        "content-type": "application/vnd.android.package-archive",
        "content-disposition": `attachment; filename="tvbox-${apk[1]}-${apk[2]}-${apk[3]}.apk"`,
        ...(object.size !== undefined ? { "content-length": String(object.size) } : {}),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  return notFound();
}
