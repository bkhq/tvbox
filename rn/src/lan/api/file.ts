import type { LanContext } from '../context';
import type { FileEntry, FileSystemPort } from '../files';
import { badRequest, forbidden, notFound, ok } from '../reply';
import type { LanEndpoint, LanParams, LanProcess, LanRequest, LanResponse } from '../types';

class ForbiddenPathError extends Error {}

/**
 * Web UI path ('/a/b', 'file://a/b', '') -> root-relative 'a/b'. Like Path.local, the first
 * 'file:/' is dropped; any '..' segment is rejected so nothing escapes the root.
 */
export function sandboxPath(raw: string): string {
  const parts = raw
    .replace('file:/', '')
    .split(/[/\\]/)
    .filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) throw new ForbiddenPathError('Forbidden');
  return parts.join('/');
}

const MIME: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  ass: 'text/plain',
  css: 'text/css',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  m3u: 'audio/mpegurl',
  m3u8: 'application/vnd.apple.mpegurl',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  srt: 'text/plain',
  ssa: 'text/plain',
  svg: 'image/svg+xml',
  ts: 'video/mp2t',
  txt: 'text/plain',
  webp: 'image/webp',
  xml: 'text/xml',
  zip: 'application/zip',
};

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export const mimeOf = (path: string) => MIME[extensionOf(path)] ?? 'application/octet-stream';

const pad = (n: number) => String(n).padStart(2, '0');

/** Formatters.LOCAL_DATETIME: yyyy/MM/dd HH:mm:ss in local time. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Path.sort: directories first, then case-insensitive by name. */
function byDirThenName(a: FileEntry, b: FileEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Local.getFolder; sent as text/plain because script.js JSON.parses the body itself. */
async function folder(fs: FileSystemPort, dir: string): Promise<LanResponse> {
  const entries = [...(await fs.list(dir))].sort(byDirThenName);
  const parent = dir === '' ? '.' : dir.includes('/') ? `/${dir.slice(0, dir.lastIndexOf('/'))}` : '';
  const files = entries.map((entry) => ({ name: entry.name, path: `/${entry.path}`, time: formatTime(entry.time), dir: entry.isDir ? 1 : 0 }));
  return ok(JSON.stringify({ parent, files }));
}

async function getFile(fs: FileSystemPort, url: string): Promise<LanResponse> {
  const path = sandboxPath(url.slice('/file'.length));
  const entry = await fs.stat(path);
  if (!entry) return notFound('File not found');
  if (entry.isDir) return folder(fs, path);
  return { status: 200, headers: { 'Content-Type': mimeOf(path) }, filePath: fs.localPath(path) };
}

const join = (dir: string, name: string) => sandboxPath(`${dir}/${name}`);

async function upload(fs: FileSystemPort, req: LanRequest, params: LanParams): Promise<LanResponse> {
  const dir = sandboxPath(params.path ?? '');
  const uploads = Object.values(req.files).map((item) => ({ temp: item.path, name: sandboxPath(item.name) }));
  if (uploads.some(({ name }) => !name || name.includes('/'))) return forbidden('Forbidden');
  if (uploads.length > 0) await fs.mkdir(dir);
  for (const { temp, name } of uploads) await fs.move(temp, join(dir, name));
  return ok();
}

async function newFolder(fs: FileSystemPort, params: LanParams): Promise<LanResponse> {
  await fs.mkdir(join(params.path ?? '', params.name ?? ''));
  return ok();
}

async function remove(fs: FileSystemPort, params: LanParams): Promise<LanResponse> {
  const path = sandboxPath(params.path ?? '');
  if (!path) return forbidden('Forbidden');
  await fs.delete(path);
  return ok();
}

async function guard(fn: () => Promise<LanResponse>): Promise<LanResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenPathError) return forbidden(error.message);
    throw error;
  }
}

const ROUTES = ['/file', '/upload', '/newFolder', '/delFolder', '/delFile'];

/** Local: the File tab's browse, download, upload, new folder and delete routes. */
export const fileProcess = (fs: FileSystemPort): LanProcess => ({
  matches: (path) => ROUTES.some((route) => path.startsWith(route)),
  handle: (req, params) =>
    guard(() => {
      const path = req.path;
      if (path.startsWith('/file')) return getFile(fs, path);
      if (path.startsWith('/upload')) return upload(fs, req, params);
      if (path.startsWith('/newFolder')) return newFolder(fs, params);
      return remove(fs, params);
    }),
});

const SUBTITLE = ['srt', 'ssa', 'ass'];

/** ActionApi file: a sandbox file becomes the VOD config; APKs and subtitles are not supported. */
export const fileApi =
  (ctx: LanContext, fs: FileSystemPort): LanEndpoint =>
  (_req, params) =>
    guard(async () => {
      const raw = (params.path ?? '').trim();
      if (!raw) return badRequest('path required');
      const path = sandboxPath(raw);
      const extension = extensionOf(path);
      if (extension === 'apk' || SUBTITLE.includes(extension)) return badRequest('不支持');
      const entry = await fs.stat(path);
      if (!entry || entry.isDir) return notFound('File not found');
      await ctx.bootstrap.addConfig(fs.uri(path));
      return ok();
    });
