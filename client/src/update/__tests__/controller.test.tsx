import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { createUpdateController, type UpdateControllerDeps } from '../controller';
import type { DownloadedApk, InstallDeps } from '../install';
import { UpdateDialog } from '../UpdateDialog';

// react-native resolves components lazily on first access; resolve the ones the
// dialog renders while the file loads so no test pays that cost inside its timeout.
void [Modal, Pressable, ScrollView, Text, View];

// Keeps the singleton (and its native deps) out of these tests.
jest.mock('../updater', () => ({ getUpdateController: jest.fn() }));

const manifest = {
  versionCode: 10203,
  versionName: '1.2.3',
  notes: '修复问题',
  url: '../apk/10203/leanback-arm64_v8a.apk',
  sha256: '',
  size: 100,
};

function setup(overrides: Partial<UpdateControllerDeps> = {}) {
  const install: jest.Mocked<InstallDeps> = {
    cachedApk: jest.fn<DownloadedApk | null, [string]>(() => null),
    downloadApk: jest.fn<Promise<DownloadedApk>, Parameters<InstallDeps['downloadApk']>>(async () => ({ size: 100, contentUri: 'content://apk', discard: jest.fn() })),
    launchInstaller: jest.fn<Promise<void>, [string]>(async () => {}),
    openURL: jest.fn<Promise<void>, [string]>(async () => {}),
  };
  const controller = createUpdateController({
    workerUrl: 'https://w',
    versionCode: 10000,
    platform: { OS: 'android', isTV: true, abi: 'arm64_v8a' },
    fetchJson: jest.fn(async () => manifest),
    install,
    ...overrides,
  });
  return { controller, install };
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAll((n) => n.type === 'Text').flatMap((n) => n.children.filter((c) => typeof c === 'string'));
}

function press(renderer: ReactTestRenderer, testID: string) {
  const [node] = renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);
  node!.props.onClick();
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('update controller', () => {
  it('opens the release on a launch check and installs it', async () => {
    const { controller, install } = setup();
    await controller.check(false);
    expect(controller.getState().release?.versionName).toBe('1.2.3');
    expect(controller.getState().lastResult).toBeNull();

    await controller.install();
    expect(install.launchInstaller).toHaveBeenCalledWith('content://apk');
    expect(controller.getState()).toMatchObject({ release: null, installState: { phase: 'idle' } });
  });

  it('keeps the dialog open with an error when the download fails', async () => {
    const { controller, install } = setup();
    install.downloadApk.mockRejectedValueOnce(new Error('boom'));
    await controller.check(false);
    await controller.install();
    expect(controller.getState()).toMatchObject({ release: { versionCode: 10203 }, installState: { phase: 'error' } });
  });

  it('shows the manual notice on tvOS', async () => {
    const { controller } = setup({ platform: { OS: 'ios', isTV: true } });
    await controller.check(false);
    await controller.install();
    expect(controller.getState().installState).toEqual({ phase: 'manual', reason: 'tvos' });
  });

  it('records manual results and stays silent on launch errors', async () => {
    const { controller } = setup({ fetchJson: jest.fn(async () => Promise.reject(new Error('offline'))) });
    expect(await controller.check(false)).toEqual({ status: 'up-to-date' });
    expect(controller.getState().lastResult).toBeNull();
    expect((await controller.check(true)).status).toBe('error');
    expect(controller.getState().lastResult?.status).toBe('error');
    expect(controller.getState().release).toBeNull();
  });

  it('dismiss aborts a running download', async () => {
    const { controller, install } = setup();
    let signal: AbortSignal | undefined;
    install.downloadApk.mockImplementationOnce(
      (_url, _name, _progress, s) =>
        new Promise((_resolve, reject) => {
          signal = s;
          s?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await controller.check(false);
    const running = controller.install();
    expect(controller.getState().installState.phase).toBe('downloading');
    controller.dismiss();
    await running;
    expect(signal?.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ release: null, installState: { phase: 'idle' } });
  });
});

describe('update UI', () => {
  it('shows a progress bar with the downloaded size while downloading', async () => {
    const { controller, install } = setup();
    let report!: (progress: { bytes: number; total: number | null }) => void;
    let finish!: () => void;
    install.downloadApk.mockImplementationOnce(
      (_url, _name, onProgress) =>
        new Promise((resolve) => {
          report = onProgress;
          finish = () => resolve({ size: 100, contentUri: 'content://apk', discard: jest.fn() });
        }),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<UpdateDialog controller={controller} />);
      await controller.check(false);
    });
    let running!: Promise<void>;
    await act(async () => {
      running = controller.install();
      report({ bytes: 12.5 * 1024 * 1024, total: 50 * 1024 * 1024 });
    });
    expect(texts(renderer)).toContain('正在下载 25%（12.5 / 50.0 MB）');
    const fill = renderer.root.findByProps({ testID: 'update-progress-fill' });
    expect(fill.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '25%' })]));
    await act(async () => {
      finish();
      await running;
    });
    expect(renderer.toJSON()).toBeNull();
  });


  it('renders the dialog with notes and installs on 立即更新', async () => {
    const { controller, install } = setup();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<UpdateDialog controller={controller} />);
    });
    expect(renderer.toJSON()).toBeNull();

    await act(async () => {
      await controller.check(false);
    });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['发现新版本 v1.2.3', '修复问题', '立即更新', '稍后']));

    await act(async () => {
      press(renderer, 'update-install');
    });
    expect(install.launchInstaller).toHaveBeenCalled();
    expect(renderer.toJSON()).toBeNull();
  });
});
