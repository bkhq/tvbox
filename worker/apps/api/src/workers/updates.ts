import type { SubscriptionBucket, SubscriptionEnv } from "./subscription";
import type { UpdateManifest } from "@/modules/tvbox/storage";
import { releaseFileKey, releaseKind, updateManifestKey } from "@/modules/tvbox/storage";

/**
 * App update endpoints, public and answered by the stateless Worker from the
 * objects the tvbox release module writes:
 *
 *   /u/<channel>/<mode>-<abi>.json        newest release for that flavor
 *   /u/apk/<versionCode>/<mode>-<abi>.apk  the APK a manifest points at
 *
 * The React Native app has its own channel under /u/rn/: the same json and
 * apk paths, `/u/rn/ipa/<versionCode>/<mode>-<abi>.ipa` for iOS and tvOS, and
 * `/u/rn/<channel>/<mode>-<abi>.plist`, the itms-services manifest that
 * installs that ipa.
 */

export const UPDATES_PREFIX = "/u/";

const RE_MANIFEST = /^\/u\/(stable|beta)\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.json$/;
const RE_APK = /^\/u\/apk\/(\d{1,10})\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.apk$/;
const RE_RN_MANIFEST = /^\/u\/rn\/(stable|beta)\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.(json|plist)$/;
const RE_RN_BINARY = /^\/u\/rn\/(apk|ipa)\/(\d{1,10})\/([a-z0-9_]{1,32})-([a-z0-9_]{1,32})\.(apk|ipa)$/;

const CONTENT_TYPES = { apk: "application/vnd.android.package-archive", ipa: "application/octet-stream" };

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
}

function itmsManifest(ipaUrl: string, manifest: UpdateManifest & { bundleId: string }): string {
  const string = (value: string) => `<string>${xmlEscape(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>${string("software-package")}
          <key>url</key>${string(ipaUrl)}
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>${string(manifest.bundleId)}
        <key>bundle-version</key>${string(manifest.versionName)}
        <key>kind</key>${string("software")}
        <key>title</key>${string("影视")}
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

const RE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * A single `bytes=` range resolved against the object size: the slice to send,
 * "unsatisfiable", or null when the header is absent or not a single byte range
 * (then the whole object is sent, as RFC 9110 allows).
 */
function parseRange(header: string | null, size: number): { offset: number; length: number } | "unsatisfiable" | null {
  const match = header
    ? RE_RANGE.exec(header.trim())
    : null;
  if (!match || (match[1] === "" && match[2] === ""))
    return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0
      ? "unsatisfiable"
      : {
          offset: Math.max(0, size - suffix),
          length: Math.min(suffix, size),
        };
  }
  const start = Number(match[1]);
  const end = match[2] === ""
    ? size - 1
    : Math.min(Number(match[2]), size - 1);
  return start >= size || end < start
    ? "unsatisfiable"
    : { offset: start, length: end - start + 1 };
}

async function serveBinary(request: Request, bucket: SubscriptionBucket, key: string, kind: "apk" | "ipa", filename: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": CONTENT_TYPES[kind],
    "content-disposition": `attachment; filename="${filename}"`,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };
  const rangeHeader = request.headers.get("range");
  if (rangeHeader && bucket.head) {
    const meta = await bucket.head(key);
    if (!meta)
      return notFound();
    const range = parseRange(rangeHeader, meta.size);
    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${meta.size}` },
      });
    }
    if (range) {
      const object = await bucket.get(key, { range });
      if (!object)
        return notFound();
      return new Response(object.body, {
        status: 206,
        headers: {
          ...headers,
          "content-length": String(range.length),
          "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`,
        },
      });
    }
  }
  const object = await bucket.get(key);
  if (!object)
    return notFound();
  return new Response(object.body, {
    headers: {
      ...headers,
      ...(object.size !== undefined
        ? {
            "content-length": String(object.size),
          }
        : {}),
    },
  });
}

async function handleRn(request: Request, pathname: string, bucket: SubscriptionBucket): Promise<Response> {
  const manifest = RE_RN_MANIFEST.exec(pathname);
  if (manifest) {
    const mode = manifest[2]!;
    const ext = manifest[4]!;
    if (ext === "plist" && releaseKind("rn", mode) !== "ipa")
      return notFound();
    const object = await bucket.get(updateManifestKey(manifest[1]!, mode, manifest[3]!, "rn"));
    if (!object)
      return notFound();
    if (ext === "json") {
      return new Response(object.body, {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
      });
    }
    const data = JSON.parse(await object.text()) as UpdateManifest;
    if (typeof data.bundleId !== "string")
      return notFound();
    const ipaUrl = new URL(data.url, request.url).href;
    return new Response(itmsManifest(ipaUrl, { ...data, bundleId: data.bundleId }), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  const binary = RE_RN_BINARY.exec(pathname);
  if (binary) {
    const [, dir, code, mode, abi, ext] = binary;
    const kind = releaseKind("rn", mode!);
    if (dir !== kind || ext !== kind)
      return notFound();
    return await serveBinary(request, bucket, releaseFileKey(Number(code), mode!, abi!, "rn"), kind, `rn-${code}-${mode}-${abi}.${kind}`);
  }
  return notFound();
}

export async function handleUpdates(request: Request, env: SubscriptionEnv): Promise<Response> {
  const bucket = env.FILES;
  if (!bucket)
    return notFound();
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });

  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/u/rn/"))
    return await handleRn(request, pathname, bucket);

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
  if (apk)
    return await serveBinary(request, bucket, releaseFileKey(Number(apk[1]), apk[2]!, apk[3]!), "apk", `tvbox-${apk[1]}-${apk[2]}-${apk[3]}.apk`);
  return notFound();
}
