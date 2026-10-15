import { clearCache, formatBytes, getCacheSize } from '../cache';

class File {
  delete = jest.fn();
  constructor(readonly size: number | null) {}
}

class Directory {
  delete = jest.fn();
  constructor(readonly items: (File | Directory)[]) {}
  list() {
    return this.items;
  }
}

/** Stand-in for the expo-file-system module rooted at `cache`. */
function fileSystem(cache: Directory) {
  return async () => ({ Directory, Paths: { cache } }) as unknown as typeof import('expo-file-system');
}

describe('formatBytes', () => {
  it('formats binary units with one decimal below 10', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(25.4 * 1024 * 1024)).toBe('25 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
  });
});

/** Stand-in for expo-file-system/legacy, whose getInfoAsync sizes a directory natively. */
function infoFileSystem(cacheDirectory: string | null, info: { exists: boolean; size?: number }) {
  const getInfoAsync = jest.fn(async () => info);
  return { getInfoAsync, load: async () => ({ cacheDirectory, getInfoAsync }) as never };
}

describe('cache size', () => {
  it('asks the native side for the size of the cache directory', async () => {
    const fs = infoFileSystem('file:///cache/', { exists: true, size: 1024 });
    await expect(getCacheSize(fs.load)).resolves.toBe(1024);
    expect(fs.getInfoAsync).toHaveBeenCalledWith('file:///cache/');
  });

  it('is 0 without a cache directory', async () => {
    await expect(getCacheSize(infoFileSystem(null, { exists: false }).load)).resolves.toBe(0);
    await expect(getCacheSize(infoFileSystem('file:///cache/', { exists: false }).load)).resolves.toBe(0);
  });
});

describe('cache directory', () => {
  it('clears the contents only', async () => {
    const a = new File(1000);
    const b = new File(null);
    const c = new File(24);
    const nested = new Directory([c, new Directory([])]);
    const root = new Directory([a, b, nested]);

    await clearCache(fileSystem(root));
    expect(a.delete).toHaveBeenCalled();
    expect(b.delete).toHaveBeenCalled();
    expect(nested.delete).toHaveBeenCalled();
    expect(c.delete).not.toHaveBeenCalled();
    expect(root.delete).not.toHaveBeenCalled();
  });
});
