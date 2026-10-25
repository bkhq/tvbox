import type { SubscriptionEnv } from "./subscription";
import type { UpdateManifest } from "@/modules/tvbox/storage";
import { MANIFEST_INDEX_KEY } from "@/modules/tvbox/storage";

/**
 * The public page at `/`: the APKs of the newest stable release, read from
 * the update manifests the release module writes. A flavor whose newest APK
 * is older is not offered. Rendered here so the site root
 * needs neither the console bundle nor the Durable Object.
 */

const RE_STABLE = /^tvbox\/updates\/stable\/([a-z0-9_]+)-([a-z0-9_]+)\.json$/;

const MODES: Record<string, { label: string; hint: string; order: number }> = {
  leanback: { label: "电视版", hint: "电视、盒子，遥控器操作", order: 0 },
  mobile: { label: "手机版", hint: "手机、平板，触屏操作", order: 1 },
};

const ABIS: Record<string, { label: string; hint: string; order: number }> = {
  arm64_v8a: { label: "64 位", hint: "arm64-v8a，大多数设备选这个", order: 0 },
  armeabi_v7a: { label: "32 位", hint: "armeabi-v7a，较老或低配设备", order: 1 },
};

interface Download {
  readonly mode: string;
  readonly abi: string;
  readonly manifest: UpdateManifest;
  readonly href: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]!);
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readDownloads(env: SubscriptionEnv): Promise<Download[]> {
  const bucket = env.FILES;
  if (!bucket)
    return [];
  const index = await bucket.get(MANIFEST_INDEX_KEY);
  if (!index)
    return [];
  const keys = (JSON.parse(await index.text()) as string[]).filter(k => RE_STABLE.test(k));
  const downloads = await Promise.all(keys.map(async (key) => {
    const object = await bucket.get(key);
    if (!object)
      return null;
    const [, mode, abi] = RE_STABLE.exec(key)!;
    const manifest = JSON.parse(await object.text()) as UpdateManifest;
    // Manifest URLs are relative to the manifest itself.
    const href = new URL(manifest.url, `https://site/${key.replace(/^tvbox\/updates\//, "u/")}`).pathname;
    return {
      mode: mode!,
      abi: abi!,
      manifest,
      href,
    };
  }));
  const found = downloads.filter((d): d is Download => d !== null);
  const newest = Math.max(...found.map(d => d.manifest.versionCode));
  return found
    .filter(d => d.manifest.versionCode === newest)
    .sort((a, b) => (MODES[a.mode]?.order ?? 9) - (MODES[b.mode]?.order ?? 9) || (ABIS[a.abi]?.order ?? 9) - (ABIS[b.abi]?.order ?? 9));
}

function card(d: Download): string {
  const mode = MODES[d.mode] ?? { label: d.mode, hint: "" };
  const abi = ABIS[d.abi] ?? { label: d.abi, hint: "" };
  return `
      <li class="card">
        <div>
          <h2>${escapeHtml(mode.label)} · ${escapeHtml(abi.label)}</h2>
          <p class="hint">${escapeHtml([mode.hint, abi.hint].filter(Boolean).join("；"))} · ${megabytes(d.manifest.size)}</p>
        </div>
        <a class="button" href="${escapeHtml(d.href)}" download>下载</a>
      </li>`;
}

function page(downloads: readonly Download[]): string {
  const release = downloads[0]?.manifest;
  // Every flavor of a release carries the same notes.
  const text = downloads.find(d => d.manifest.notes.trim())?.manifest.notes.trim();
  const notes = text
    ? `\n    <p class="notes">${escapeHtml(text)}</p>`
    : "";
  const body = release
    ? `<p class="meta">最新版本 ${escapeHtml(release.versionName)} · ${release.createdAt.slice(0, 10)}</p>${notes}
    <ul>${downloads.map(card).join("")}\n    </ul>`
    : `<p class="empty">暂无可下载的版本。</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TVBox 下载</title>
  <style>
    :root { color-scheme: light dark; --fg: #111827; --muted: #6b7280; --line: #e5e7eb; --card: #fff; --bg: #f9fafb; --accent: #1d4ed8; }
    @media (prefers-color-scheme: dark) { :root { --fg: #f3f4f6; --muted: #9ca3af; --line: #374151; --card: #1f2937; --bg: #111827; --accent: #3b82f6; } }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--fg); background: var(--bg); }
    main { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 4px; font-size: 28px; }
    .lead { margin: 0 0 28px; color: var(--muted); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .card { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
    h2 { margin: 0; font-size: 18px; }
    .hint { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
    .meta { margin: 0 0 8px; font-weight: 600; }
    .notes { margin: 0 0 20px; padding: 12px 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); white-space: pre-line; font-size: 14px; }
    .button { flex: none; padding: 8px 18px; border-radius: 8px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
    .empty { color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <h1>TVBox</h1>
    <p class="lead">选择适合你设备的版本下载安装。已安装的应用会自动提示更新。</p>
    ${body}
  </main>
</body>
</html>
`;
}

export async function handleLanding(request: Request, env: SubscriptionEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });
  return new Response(page(await readDownloads(env)), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
