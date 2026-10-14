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

describe('cache directory', () => {
  it('sums file sizes recursively and clears the contents only', async () => {
    const a = new File(1000);
    const b = new File(null);
    const c = new File(24);
    const nested = new Directory([c, new Directory([])]);
    const root = new Directory([a, b, nested]);

    await expect(getCacheSize(fileSystem(root))).resolves.toBe(1024);

    await clearCache(fileSystem(root));
    expect(a.delete).toHaveBeenCalled();
    expect(b.delete).toHaveBeenCalled();
    expect(nested.delete).toHaveBeenCalled();
    expect(c.delete).not.toHaveBeenCalled();
    expect(root.delete).not.toHaveBeenCalled();
  });
});
