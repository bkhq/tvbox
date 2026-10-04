import { installUpdate, SizeMismatchError, type DownloadedApk, type InstallDeps } from '../install';
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
    plistUrl: flavor === 'android-universal' ? undefined : `https://w/u/rn/stable/${flavor}.plist`,
    ...overrides,
  };
}

function deps(size = 100): jest.Mocked<InstallDeps> & { discard: jest.Mock } {
  const discard = jest.fn();
  return {
    discard,
    downloadApk: jest.fn<Promise<DownloadedApk>, Parameters<InstallDeps['downloadApk']>>(async (_url, onProgress) => {
      onProgress(0.5);
      return { size, contentUri: 'content://apk', discard };
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
    expect(await installUpdate(release('android-universal'), d, { onProgress, onDownloaded })).toEqual({ status: 'started' });
    expect(d.downloadApk).toHaveBeenCalledWith('https://w/u/rn/apk/10203/android-universal.apk', onProgress, undefined);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onDownloaded).toHaveBeenCalled();
    expect(d.launchInstaller).toHaveBeenCalledWith('content://apk');
    expect(d.openURL).not.toHaveBeenCalled();
  });

  it('rejects an apk with the wrong size', async () => {
    const d = deps(99);
    await expect(installUpdate(release('android-universal'), d)).rejects.toBeInstanceOf(SizeMismatchError);
    expect(d.discard).toHaveBeenCalled();
    expect(d.launchInstaller).not.toHaveBeenCalled();
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
