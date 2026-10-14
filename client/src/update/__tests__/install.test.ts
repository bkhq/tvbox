import { ChecksumMismatchError, installUpdate, SizeMismatchError, type DownloadedApk, type InstallDeps } from '../install';
import type { Release, UpdateFlavor } from '../logic';

function release(flavor: UpdateFlavor, overrides: Partial<Release> = {}): Release {
  return {
    versionCode: 10203,
    versionName: '1.2.3',
    notes: '',
    url: 'x',
    sha256: '',
    size: 100,
    flavor,
    manifestUrl: `https://w/u/rn/stable/${flavor}.json`,
    binaryUrl: `https://w/u/rn/apk/10203/${flavor}.apk`,
    plistUrl: flavor.startsWith('leanback-') ? undefined : `https://w/u/rn/stable/${flavor}.plist`,
    ...overrides,
  };
}

const HASH = 'ab'.repeat(32);

function deps(size = 100, hash: string | null = HASH): jest.Mocked<InstallDeps> & { discard: jest.Mock; sha256: jest.Mock } {
  const discard = jest.fn();
  const sha256 = jest.fn(async () => hash ?? '');
  return {
    discard,
    sha256,
    cachedApk: jest.fn<DownloadedApk | null, [string]>(() => null),
    downloadApk: jest.fn<Promise<DownloadedApk>, Parameters<InstallDeps['downloadApk']>>(async (_url, _name, onProgress) => {
      onProgress({ bytes: 50, total: 100 });
      return { size, contentUri: 'content://apk', discard, ...(hash === null ? {} : { sha256 }) };
    }),
    launchInstaller: jest.fn<Promise<void>, [string]>(async () => {}),
    openURL: jest.fn<Promise<void>, [string]>(async () => {}),
  };
}

describe('installUpdate', () => {
  it('downloads and launches the installer on android', async () => {
    const d = deps();
    const onProgress = jest.fn();
    const onDownloaded = jest.fn();
    expect(await installUpdate(release('leanback-arm64_v8a'), d, { onProgress, onDownloaded })).toEqual({ status: 'started' });
    expect(d.cachedApk).toHaveBeenCalledWith('10203-leanback-arm64_v8a.apk');
    expect(d.downloadApk).toHaveBeenCalledWith(
      'https://w/u/rn/apk/10203/leanback-arm64_v8a.apk',
      '10203-leanback-arm64_v8a.apk',
      onProgress,
      undefined,
    );
    expect(onProgress).toHaveBeenCalledWith({ bytes: 50, total: 100 });
    expect(onDownloaded).toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
    expect(d.openURL).not.toHaveBeenCalled();
  });

  it('reuses a cached apk that matches the manifest without downloading', async () => {
    const d = deps();
    const cachedDiscard = jest.fn();
    d.cachedApk.mockReturnValue({ size: 100, contentUri: 'content://cached', discard: cachedDiscard, sha256: async () => HASH });
    const onVerifying = jest.fn();
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: HASH }), d, { onVerifying })).toEqual({ status: 'started' });
    expect(onVerifying).toHaveBeenCalled();
    expect(d.downloadApk).not.toHaveBeenCalled();
    expect(cachedDiscard).not.toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://cached');
  });

  it('discards a cached apk that fails verification and downloads again', async () => {
    const d = deps();
    const cachedDiscard = jest.fn();
    d.cachedApk.mockReturnValue({ size: 100, contentUri: 'content://cached', discard: cachedDiscard, sha256: async () => 'ef'.repeat(32) });
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: HASH }), d)).toEqual({ status: 'started' });
    expect(cachedDiscard).toHaveBeenCalled();
    expect(d.downloadApk).toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
  });

  it('skips the size check when the manifest has no size', async () => {
    const d = deps(42);
    expect(await installUpdate(release('leanback-armeabi_v7a', { size: undefined }), d)).toEqual({ status: 'started' });
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
  });

  it('rejects an apk with the wrong size', async () => {
    const d = deps(99);
    await expect(installUpdate(release('leanback-arm64_v8a'), d)).rejects.toBeInstanceOf(SizeMismatchError);
    expect(d.discard).toHaveBeenCalled();
    expect(d.launchInstaller).not.toHaveBeenCalled();
  });

  it('launches the installer when the sha256 matches', async () => {
    const d = deps();
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: HASH }), d)).toEqual({ status: 'started' });
    expect(d.sha256).toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
  });

  it('accepts an uppercase manifest sha256', async () => {
    const d = deps();
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: HASH.toUpperCase() }), d)).toEqual({ status: 'started' });
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
  });

  it('rejects an apk with the wrong sha256', async () => {
    const d = deps(100, 'cd'.repeat(32));
    const onDownloaded = jest.fn();
    await expect(installUpdate(release('leanback-arm64_v8a', { sha256: HASH }), d, { onDownloaded })).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
    expect(d.discard).toHaveBeenCalled();
    expect(onDownloaded).not.toHaveBeenCalled();
    expect(d.launchInstaller).not.toHaveBeenCalled();
  });

  it('skips the sha256 check when the manifest sha256 is empty', async () => {
    const d = deps();
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: '' }), d)).toEqual({ status: 'started' });
    expect(d.sha256).not.toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
  });

  it('falls back to the size check when the native hash is unavailable', async () => {
    const d = deps(100, null);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await installUpdate(release('leanback-arm64_v8a', { sha256: HASH }), d)).toEqual({ status: 'started' });
    expect(warn).toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
    warn.mockRestore();
  });

  it('opens itms-services on iOS', async () => {
    const d = deps();
    expect(await installUpdate(release('ios-universal'), d)).toEqual({ status: 'started' });
    expect(d.openURL).toHaveBeenCalledWith(
      `itms-services://?action=download-manifest&url=${encodeURIComponent('https://w/u/rn/stable/ios-universal.plist')}`,
    );
    expect(d.downloadApk).not.toHaveBeenCalled();
  });

  it('falls back to the manual notice when iOS cannot open the url', async () => {
    const d = deps();
    d.openURL.mockRejectedValueOnce(new Error('no handler'));
    expect(await installUpdate(release('ios-universal'), d)).toEqual({ status: 'manual', reason: 'cannot-open' });
  });

  it('shows the manual notice on tvOS without side effects', async () => {
    const d = deps();
    expect(await installUpdate(release('tvos-universal'), d)).toEqual({ status: 'manual', reason: 'tvos' });
    expect(d.openURL).not.toHaveBeenCalled();
    expect(d.downloadApk).not.toHaveBeenCalled();
  });
});
