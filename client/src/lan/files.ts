/**
 * Sandbox file access for the LAN file browser. Paths are relative to the root ('' is the root,
 * 'a/b' a child) and already checked by the caller; the root is the app's document directory.
 */

export interface FileEntry {
  name: string;
  /** Relative to the root, '/'-separated, no leading slash. */
  path: string;
  isDir: boolean;
  /** Bytes; 0 for directories. */
  size: number;
  /** Last modification, epoch milliseconds. */
  time: number;
}

export interface FileSystemPort {
  list(dir: string): Promise<FileEntry[]>;
  /** null when nothing exists at `path`. */
  stat(path: string): Promise<FileEntry | null>;
  /** Creates the directory and its parents; no-op when it exists. */
  mkdir(path: string): Promise<void>;
  /** Deletes a file, or a directory recursively. */
  delete(path: string): Promise<void>;
  /** Moves an uploaded temp file (absolute path from the transport) to `destPath`, replacing it. */
  move(tempPath: string, destPath: string): Promise<void>;
  /** Absolute filesystem path, for LanResponse.filePath. */
  localPath(path: string): string;
  /** file:// URL. */
  uri(path: string): string;
}

const segments = (path: string) => path.split('/').filter(Boolean);

const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

/** FileSystemPort on expo-file-system, rooted at Paths.document; the native module loads on first use. */
export async function createExpoFileSystem(): Promise<FileSystemPort> {
  const { Directory, File, Paths } = await import('expo-file-system');
  const root = Paths.document;
  const dirAt = (path: string) => new Directory(root, ...segments(path));
  const fileAt = (path: string) => new File(root, ...segments(path));
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

  return {
    async list(dir) {
      return dirAt(dir)
        .list()
        .map((item) =>
          item instanceof Directory
            ? { name: item.name, path: join(dir, item.name), isDir: true, size: 0, time: item.info().modificationTime ?? 0 }
            : { name: item.name, path: join(dir, item.name), isDir: false, size: item.size ?? 0, time: item.modificationTime ?? 0 },
        );
    },
    async stat(path) {
      const name = segments(path).at(-1) ?? '';
      const info = Paths.info(dirAt(path).uri);
      if (!info.exists) return null;
      if (info.isDirectory) return { name, path, isDir: true, size: 0, time: dirAt(path).info().modificationTime ?? 0 };
      const file = fileAt(path);
      return { name, path, isDir: false, size: file.size ?? 0, time: file.modificationTime ?? 0 };
    },
    async mkdir(path) {
      dirAt(path).create({ intermediates: true, idempotent: true });
    },
    async delete(path) {
      const info = Paths.info(dirAt(path).uri);
      if (!info.exists) return;
      if (info.isDirectory) dirAt(path).delete();
      else fileAt(path).delete();
    },
    async move(tempPath, destPath) {
      await new File(toUri(tempPath)).move(fileAt(destPath), { overwrite: true });
    },
    localPath(path) {
      return decodeURI(fileAt(path).uri.replace(/^file:\/\//, ''));
    },
    uri(path) {
      return fileAt(path).uri;
    },
  };
}
