import { request, setup } from '../__fixtures__/fakes';
import { sandboxPath } from '../api/file';
import type { FileEntry, FileSystemPort } from '../files';
import { createLanServer } from '../server';

const ROOT = '/data/docs';
const TIME = new Date(2026, 9, 4, 8, 5, 9).getTime();

/** In-memory sandbox: directories are entries with isDir; temp uploads live outside the tree. */
class MemoryFileSystem implements FileSystemPort {
  readonly entries = new Map<string, FileEntry>();
  readonly temps = new Map<string, number>();

  constructor(paths: string[] = []) {
    for (const path of paths) this.add(path);
  }

  add(path: string, size = 10) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.put(parts.slice(0, i).join('/'), true, 0);
    if (path.endsWith('/')) this.put(path.slice(0, -1), true, 0);
    else this.put(path, false, size);
  }

  private put(path: string, isDir: boolean, size: number) {
    if (!this.entries.has(path)) this.entries.set(path, { name: path.slice(path.lastIndexOf('/') + 1), path, isDir, size, time: TIME });
  }

  async list(dir: string) {
    const prefix = dir ? `${dir}/` : '';
    return [...this.entries.values()].filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'));
  }

  async stat(path: string) {
    if (path === '') return { name: '', path: '', isDir: true, size: 0, time: TIME };
    return this.entries.get(path) ?? null;
  }

  async mkdir(path: string) {
    if (path) this.add(`${path}/`);
  }

  async delete(path: string) {
    for (const key of [...this.entries.keys()]) if (key === path || key.startsWith(`${path}/`)) this.entries.delete(key);
  }

  async move(tempPath: string, destPath: string) {
    const size = this.temps.get(tempPath);
    if (size === undefined) throw new Error(`no temp ${tempPath}`);
    this.temps.delete(tempPath);
    this.entries.delete(destPath);
    this.add(destPath, size);
  }

  localPath(path: string) {
    return `${ROOT}/${path}`;
  }

  uri(path: string) {
    return `file://${ROOT}/${path}`;
  }
}

async function setupFiles(paths: string[] = []) {
  const fs = new MemoryFileSystem(paths);
  const base = await setup();
  const server = createLanServer(base.server.context, fs);
  const call = (path: string, params: Record<string, string> = {}, init: Parameters<typeof request>[1] = {}) =>
    server.handle(request(path, { remoteAddress: '127.0.0.1', query: params, ...init }));
  return { ...base, fs, server, call };
}

const listing = (res: { body?: string }) => JSON.parse(res.body ?? '') as { parent: string; files: { name: string; path: string; time: string; dir: number }[] };

describe('sandboxPath', () => {
  it.each([
    ['', ''],
    ['/', ''],
    ['/a/b', 'a/b'],
    ['file://a/b.json', 'a/b.json'],
    ['file:/a/./b', 'a/b'],
  ])('maps %p to %p', (raw, path) => expect(sandboxPath(raw)).toBe(path));

  it.each(['/..', '/a/../../etc', 'file://../x', '/a\\..\\..\\x'])('rejects %p', (raw) => expect(() => sandboxPath(raw)).toThrow('Forbidden'));
});

describe('/file', () => {
  it('lists the root as text JSON, directories first, case-insensitive', async () => {
    const { call } = await setupFiles(['b.txt', 'A.json', 'z/', 'm/x.txt']);
    const res = await call('/file');
    expect(res.status).toBe(200);
    expect(res.headers?.['Content-Type']).toMatch(/^text\/plain/);
    expect(listing(res)).toEqual({
      parent: '.',
      files: [
        { name: 'm', path: '/m', time: '2026/10/04 08:05:09', dir: 1 },
        { name: 'z', path: '/z', time: '2026/10/04 08:05:09', dir: 1 },
        { name: 'A.json', path: '/A.json', time: '2026/10/04 08:05:09', dir: 0 },
        { name: 'b.txt', path: '/b.txt', time: '2026/10/04 08:05:09', dir: 0 },
      ],
    });
  });

  it('reports the parent of nested directories', async () => {
    const { call } = await setupFiles(['a/b/c.txt']);
    expect(listing(await call('/file/a')).parent).toBe('');
    const nested = listing(await call('/file/a/b'));
    expect(nested.parent).toBe('/a');
    expect(nested.files).toEqual([expect.objectContaining({ name: 'c.txt', path: '/a/b/c.txt', dir: 0 })]);
  });

  it('streams a file with its mime type', async () => {
    const { call } = await setupFiles(['v/movie.MP4', 'v/data.bin']);
    expect(await call('/file/v/movie.MP4')).toEqual({ status: 200, headers: { 'Content-Type': 'video/mp4' }, filePath: `${ROOT}/v/movie.MP4` });
    expect((await call('/file/v/data.bin')).headers?.['Content-Type']).toBe('application/octet-stream');
  });

  it('answers 404 for a missing path and 403 outside the root', async () => {
    const { call } = await setupFiles();
    expect((await call('/file/missing.txt')).status).toBe(404);
    expect(await call('/file/../etc/passwd')).toMatchObject({ status: 403, body: 'Forbidden' });
  });
});

describe('/upload', () => {
  it('moves each upload into the target directory under its original name', async () => {
    const { call, fs } = await setupFiles(['in/']);
    fs.temps.set('/tmp/httpd-1.upload', 3);
    fs.temps.set('/tmp/httpd-2.upload', 7);
    const res = await call('/upload', {}, {
      method: 'POST',
      form: { path: '/in' },
      files: { 'files-0': { path: '/tmp/httpd-1.upload', name: 'a.json', size: 3 }, 'files-1': { path: '/tmp/httpd-2.upload', name: 'b.txt', size: 7 } },
    });
    expect(res).toMatchObject({ status: 200, body: 'OK' });
    expect(fs.entries.get('in/a.json')).toMatchObject({ isDir: false, size: 3 });
    expect(fs.entries.get('in/b.txt')).toMatchObject({ isDir: false, size: 7 });
    expect(fs.temps.size).toBe(0);
  });

  it('uploads to the root when path is empty', async () => {
    const { call, fs } = await setupFiles();
    fs.temps.set('/tmp/t', 1);
    await call('/upload', {}, { method: 'POST', form: { path: '' }, files: { 'files-0': { path: '/tmp/t', name: 'x.json', size: 1 } } });
    expect(fs.entries.has('x.json')).toBe(true);
  });

  it('rejects target directories and names escaping the root', async () => {
    const { call, fs } = await setupFiles();
    fs.temps.set('/tmp/t', 1);
    const files = { 'files-0': { path: '/tmp/t', name: 'x.json', size: 1 } };
    expect((await call('/upload', {}, { method: 'POST', form: { path: '/..' }, files })).status).toBe(403);
    for (const name of ['../x.json', 'a/x.json', '..']) {
      const res = await call('/upload', {}, { method: 'POST', form: { path: '' }, files: { 'files-0': { path: '/tmp/t', name, size: 1 } } });
      expect(res.status).toBe(403);
    }
    expect(fs.entries.size).toBe(0);
  });
});

describe('/newFolder', () => {
  it('creates path/name', async () => {
    const { call, fs } = await setupFiles(['a/']);
    expect(await call('/newFolder', { path: '/a', name: 'new' })).toMatchObject({ status: 200, body: 'OK' });
    expect(fs.entries.get('a/new')).toMatchObject({ isDir: true });
  });

  it('rejects names escaping the root', async () => {
    const { call, fs } = await setupFiles();
    expect((await call('/newFolder', { path: '', name: '../../x' })).status).toBe(403);
    expect(fs.entries.size).toBe(0);
  });
});

describe('/delFolder and /delFile', () => {
  it('deletes a directory recursively', async () => {
    const { call, fs } = await setupFiles(['a/b/c.txt', 'keep.txt']);
    expect(await call('/delFolder', { path: '/a' })).toMatchObject({ status: 200, body: 'OK' });
    expect([...fs.entries.keys()]).toEqual(['keep.txt']);
  });

  it('deletes a file', async () => {
    const { call, fs } = await setupFiles(['a/c.txt', 'a/d.txt']);
    await call('/delFile', { path: '/a/c.txt' });
    expect([...fs.entries.keys()].sort()).toEqual(['a', 'a/d.txt']);
  });

  it('refuses the root and paths outside it', async () => {
    const { call, fs } = await setupFiles(['a.txt']);
    expect((await call('/delFolder', { path: '' })).status).toBe(403);
    expect((await call('/delFolder', { path: '/' })).status).toBe(403);
    expect((await call('/delFile', { path: '/../a.txt' })).status).toBe(403);
    expect(fs.entries.size).toBe(1);
  });
});

describe('/api/file', () => {
  it('requires path', async () => {
    const { call } = await setupFiles();
    expect(await call('/api/file')).toMatchObject({ status: 400, body: 'path required' });
  });

  it.each(['file://sub/a.srt', 'file://sub/a.ASS', 'file://sub/a.ssa', 'file://app.apk'])('does not support %p', async (path) => {
    const { call, bootstrap } = await setupFiles(['sub/a.srt', 'sub/a.ASS', 'sub/a.ssa', 'app.apk']);
    expect(await call('/api/file', { path })).toMatchObject({ status: 400, body: '不支持' });
    expect(bootstrap.addConfig).not.toHaveBeenCalled();
  });

  it('uses the file as the VOD config', async () => {
    const { call, bootstrap, vod } = await setupFiles(['cfg/my.json']);
    expect(await call('/api/file', { path: 'file://cfg/my.json' })).toMatchObject({ status: 200, body: 'OK' });
    expect(bootstrap.addConfig).toHaveBeenCalledWith(`file://${ROOT}/cfg/my.json`);
    expect((await vod.getActive())?.url).toBe(`file://${ROOT}/cfg/my.json`);
  });

  it('answers 404 for missing files or directories and 403 outside the root', async () => {
    const { call, bootstrap } = await setupFiles(['cfg/']);
    expect((await call('/api/file', { path: 'file://cfg/none.json' })).status).toBe(404);
    expect((await call('/api/file', { path: 'file://cfg' })).status).toBe(404);
    expect((await call('/api/file', { path: 'file://../x.json' })).status).toBe(403);
    expect(bootstrap.addConfig).not.toHaveBeenCalled();
  });
});

describe('createLanServer without a file system', () => {
  it('leaves the file routes to the web assets and /api/file unknown', async () => {
    const { call } = await setup();
    expect((await call('/api/file', { path: 'file://a.json' })).status).toBe(404);
    expect((await call('/newFolder', { path: '', name: 'x' })).status).toBe(404);
  });
});
