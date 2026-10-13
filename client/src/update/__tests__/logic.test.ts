import { HttpError } from '../../core/http';
import {
  checkForUpdate,
  compareVersion,
  isNewer,
  itmsServicesUrl,
  manifestUrl,
  parseManifest,
  plistUrl,
  resolveBinaryUrl,
  updateFlavor,
  type CheckOptions,
} from '../logic';
import javaManifest from './fixtures/leanback-arm64_v8a.json';

const WORKER = 'https://w.example.com';

const manifestJson = {
  versionCode: 10203,
  versionName: '1.2.3',
  notes: 'Fixes',
  url: '../apk/10203/android-universal.apk',
  sha256: 'ab'.repeat(32),
  size: 1234,
  createdAt: '2026-10-01T00:00:00Z',
};

describe('version compare', () => {
  it('compares integer version codes', () => {
    expect(compareVersion(2, 1)).toBe(1);
    expect(compareVersion(1, 1)).toBe(0);
    expect(compareVersion(1, 2)).toBe(-1);
  });

  it('isNewer only accepts larger integer codes', () => {
    expect(isNewer({ versionCode: 10100 }, 10000)).toBe(true);
    expect(isNewer({ versionCode: 10000 }, 10000)).toBe(false);
    expect(isNewer({ versionCode: 9999 }, 10000)).toBe(false);
    expect(isNewer({ versionCode: 10100.5 }, 10000)).toBe(false);
    expect(isNewer({ versionCode: Number.NaN }, 10000)).toBe(false);
  });
});

describe('updateFlavor', () => {
  it.each([
    [{ OS: 'android', isTV: true, abi: 'arm64_v8a' }, 'leanback-arm64_v8a'],
    [{ OS: 'android', isTV: false, abi: 'armeabi_v7a' }, 'leanback-armeabi_v7a'],
    [{ OS: 'android', isTV: true, abi: '' }, null],
    [{ OS: 'android', isTV: true }, null],
    [{ OS: 'android', isTV: true, abi: 'x86' }, null],
    [{ OS: 'ios', isTV: false }, 'ios-universal'],
    [{ OS: 'ios', isTV: true }, 'tvos-universal'],
    [{ OS: 'web', isTV: false }, null],
    [{ OS: 'windows', isTV: false }, null],
  ])('%j -> %s', (platform, flavor) => {
    expect(updateFlavor(platform)).toBe(flavor);
  });
});

describe('urls', () => {
  it('builds manifest and plist urls', () => {
    expect(manifestUrl(WORKER, 'stable', 'leanback-arm64_v8a')).toBe(`${WORKER}/u/stable/leanback-arm64_v8a.json`);
    expect(manifestUrl(WORKER, 'stable', 'leanback-armeabi_v7a')).toBe(`${WORKER}/u/stable/leanback-armeabi_v7a.json`);
    expect(manifestUrl(WORKER, 'stable', 'ios-universal')).toBe(`${WORKER}/u/rn/stable/ios-universal.json`);
    expect(manifestUrl(WORKER, 'stable', 'tvos-universal')).toBe(`${WORKER}/u/rn/stable/tvos-universal.json`);
    expect(plistUrl(WORKER, 'stable', 'ios-universal')).toBe(`${WORKER}/u/rn/stable/ios-universal.plist`);
  });

  it('encodes the plist url into itms-services', () => {
    expect(itmsServicesUrl(`${WORKER}/u/rn/stable/ios-universal.plist?a=1&b=2`)).toBe(
      'itms-services://?action=download-manifest&url=https%3A%2F%2Fw.example.com%2Fu%2Frn%2Fstable%2Fios-universal.plist%3Fa%3D1%26b%3D2',
    );
  });

  it.each([
    ['../apk/10203/android-universal.apk', `${WORKER}/u/rn/apk/10203/android-universal.apk`],
    ['../ipa/10203/ios-universal.ipa', `${WORKER}/u/rn/ipa/10203/ios-universal.ipa`],
    ['x.apk', `${WORKER}/u/rn/stable/x.apk`],
    ['./x.apk?v=1', `${WORKER}/u/rn/stable/x.apk?v=1`],
    ['/root.apk', `${WORKER}/root.apk`],
    ['../../../../../x.apk', `${WORKER}/x.apk`],
    ['//cdn.example.com/a.apk', 'https://cdn.example.com/a.apk'],
    ['https://cdn.example.com/a.apk', 'https://cdn.example.com/a.apk'],
  ])('resolves %s against the manifest url', (reference, expected) => {
    expect(resolveBinaryUrl(`${WORKER}/u/rn/stable/android-universal.json`, reference)).toBe(expected);
  });

  it('keeps a worker path prefix while resolving', () => {
    expect(resolveBinaryUrl('https://h.example.com/base/u/rn/stable/a.json?x=1', '../apk/1/a.apk')).toBe(
      'https://h.example.com/base/u/rn/apk/1/a.apk',
    );
  });
});

describe('parseManifest', () => {
  it('accepts the contract shape and ignores extra fields', () => {
    expect(parseManifest(manifestJson)).toEqual({
      versionCode: 10203,
      versionName: '1.2.3',
      notes: 'Fixes',
      url: '../apk/10203/android-universal.apk',
      sha256: 'ab'.repeat(32),
      size: 1234,
    });
  });

  it('accepts the Java channel manifest the worker writes', () => {
    expect(parseManifest(javaManifest)).toEqual({
      versionCode: 10005,
      versionName: '1.0.5',
      notes: javaManifest.notes,
      url: '../apk/10005/leanback-arm64_v8a.apk',
      sha256: javaManifest.sha256,
      size: javaManifest.size,
    });
  });

  it('only requires the fields the Java updater reads', () => {
    const { versionCode, versionName, url, sha256 } = javaManifest;
    expect(parseManifest({ versionCode, versionName, url, sha256 })).toEqual({ versionCode, versionName, notes: '', url, sha256 });
  });

  it('keeps bundleId and defaults missing notes', () => {
    const { notes: _notes, ...rest } = manifestJson;
    expect(parseManifest({ ...rest, bundleId: 'io.bk.tv' })).toMatchObject({ notes: '', bundleId: 'io.bk.tv' });
  });

  it.each([
    null,
    'x',
    [],
    { ...manifestJson, versionCode: '10203' },
    { ...manifestJson, versionCode: 1.5 },
    { ...manifestJson, versionCode: 0 },
    { ...manifestJson, versionName: '' },
    { ...manifestJson, notes: 3 },
    { ...manifestJson, url: '' },
    { ...manifestJson, sha256: undefined },
    { ...manifestJson, size: -1 },
    { ...manifestJson, size: '1234' },
    { ...manifestJson, bundleId: 1 },
  ])('rejects %j', (json) => {
    expect(parseManifest(json)).toBeNull();
  });
});

describe('checkForUpdate', () => {
  const options = (overrides: Partial<CheckOptions> = {}): CheckOptions => ({
    workerUrl: WORKER,
    versionCode: 10000,
    platform: { OS: 'android', isTV: true, abi: 'arm64_v8a' },
    fetchJson: jest.fn(async () => manifestJson),
    log: jest.fn(),
    ...overrides,
  });

  it('is disabled without a worker url', async () => {
    const fetchJson = jest.fn();
    expect(await checkForUpdate(options({ workerUrl: '', fetchJson }))).toEqual({ status: 'disabled' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('is unsupported on other platforms', async () => {
    expect(await checkForUpdate(options({ platform: { OS: 'web', isTV: false } }))).toEqual({ status: 'unsupported' });
  });

  it('skips universal android builds', async () => {
    const fetchJson = jest.fn();
    expect(await checkForUpdate(options({ platform: { OS: 'android', isTV: true, abi: '' }, fetchJson }))).toEqual({ status: 'unsupported' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('is up to date when the manifest is not newer', async () => {
    expect(await checkForUpdate(options({ versionCode: 10203 }))).toEqual({ status: 'up-to-date' });
  });

  it.each(['arm64_v8a', 'armeabi_v7a'])('reads the Java channel on %s', async (abi) => {
    const fetchJson = jest.fn(async () => ({ ...javaManifest, url: `../apk/10005/leanback-${abi}.apk` }));
    const result = await checkForUpdate(options({ platform: { OS: 'android', isTV: false, abi }, fetchJson }));
    expect(fetchJson).toHaveBeenCalledWith(`${WORKER}/u/stable/leanback-${abi}.json`);
    expect(result).toEqual({
      status: 'available',
      release: expect.objectContaining({
        flavor: `leanback-${abi}`,
        versionCode: 10005,
        manifestUrl: `${WORKER}/u/stable/leanback-${abi}.json`,
        binaryUrl: `${WORKER}/u/apk/10005/leanback-${abi}.apk`,
      }),
    });
    expect(result.status === 'available' && 'plistUrl' in result.release).toBe(false);
  });

  it('adds the plist url for ipa flavors', async () => {
    const fetchJson = jest.fn(async () => ({ ...manifestJson, url: '../ipa/10203/tvos-universal.ipa', bundleId: 'io.bk.tv' }));
    const result = await checkForUpdate(options({ platform: { OS: 'ios', isTV: true }, fetchJson }));
    expect(fetchJson).toHaveBeenCalledWith(`${WORKER}/u/rn/stable/tvos-universal.json`);
    expect(result).toMatchObject({
      status: 'available',
      release: { flavor: 'tvos-universal', plistUrl: `${WORKER}/u/rn/stable/tvos-universal.plist`, bundleId: 'io.bk.tv' },
    });
  });

  it.each([true, false])('treats a missing manifest as up to date (manual %s)', async (manual) => {
    const result = await checkForUpdate(options({ manual, fetchJson: jest.fn(async () => Promise.reject(new HttpError(404, 'x'))) }));
    expect(result).toEqual({ status: 'up-to-date' });
  });

  it.each([
    ['500', new HttpError(500, 'x')],
    ['network', new TypeError('Network request failed')],
  ])('returns %s errors on a manual check', async (_name, error) => {
    const log = jest.fn();
    const result = await checkForUpdate(options({ manual: true, log, fetchJson: jest.fn(async () => Promise.reject(error)) }));
    expect(result).toEqual({ status: 'error', error });
    expect(log).toHaveBeenCalled();
  });

  it('swallows errors on a launch check', async () => {
    const log = jest.fn();
    const result = await checkForUpdate(options({ log, fetchJson: jest.fn(async () => Promise.reject(new HttpError(500, 'x'))) }));
    expect(result).toEqual({ status: 'up-to-date' });
    expect(log).toHaveBeenCalled();
  });

  it('treats an invalid manifest as an error', async () => {
    const result = await checkForUpdate(options({ manual: true, fetchJson: jest.fn(async () => ({ versionCode: 'x' })) }));
    expect(result.status).toBe('error');
  });
});
