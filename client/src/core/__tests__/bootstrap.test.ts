import { createBootstrap } from '../bootstrap';
import { parseVodConfig } from '../config';
import { createSettingsStore } from '../settings';
import { createConfigRepository, MemoryStore, type SavedConfig } from '../storage';
import { onJarConfigLoaded } from '../../spider/jar/install';

jest.mock('../../spider/jar/install', () => ({
  installJarSpiders: jest.fn(),
  onJarConfigLoaded: jest.fn(async () => undefined),
}));

const A = 'https://config.example/a';
const B = 'https://config.example/b';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup() {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  await configs.add({ url: A });
  await configs.add({ url: B });
  await configs.setActive(A);
  const loadConfig = jest.fn(async (url: string) => parseVodConfig(JSON.stringify({ sites: [], spider: url }), url));
  const bootstrap = createBootstrap({ configs, settings: createSettingsStore(store), loadConfig });
  return { configs, loadConfig, bootstrap };
}

beforeEach(() => jest.mocked(onJarConfigLoaded).mockReset().mockResolvedValue(undefined));

it('drops an older active-config lookup when a newer reload finishes first', async () => {
  const { bootstrap, configs } = await setup();
  const lookup = deferred<SavedConfig | undefined>();
  const entry = await configs.getActive();
  jest.spyOn(configs, 'getActive').mockReturnValueOnce(lookup.promise);
  const first = bootstrap.reload();
  await configs.setActive(B);
  await bootstrap.reload();
  lookup.resolve(entry);
  await first;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', config: { url: B } });
});

it('does not publish an older config after native cleanup', async () => {
  const { bootstrap, configs, loadConfig } = await setup();
  const entered = deferred<void>();
  const cleanup = deferred<void>();
  const newerFetch = deferred<void>();
  const newerConfig = deferred<ReturnType<typeof parseVodConfig>>();
  jest.mocked(onJarConfigLoaded).mockImplementationOnce(async () => {
    entered.resolve();
    await cleanup.promise;
  });
  const first = bootstrap.start();
  await entered.promise;
  loadConfig.mockImplementationOnce(() => {
    newerFetch.resolve();
    return newerConfig.promise;
  });
  await configs.setActive(B);
  const second = bootstrap.reload();
  await newerFetch.promise;
  cleanup.resolve();
  await first;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'loading', entry: { url: B } });
  newerConfig.resolve(parseVodConfig('{"sites":[]}', B));
  await second;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', entry: { url: B }, config: { url: B } });
});

it('does not publish an older config after its storage write completes', async () => {
  const { bootstrap, configs, loadConfig } = await setup();
  const entered = deferred<void>();
  const saved = deferred<SavedConfig>();
  const newerFetch = deferred<void>();
  const newerConfig = deferred<ReturnType<typeof parseVodConfig>>();
  jest.spyOn(configs, 'add').mockImplementationOnce(() => {
    entered.resolve();
    return saved.promise;
  });
  const first = bootstrap.start();
  await entered.promise;
  loadConfig.mockImplementationOnce(() => {
    newerFetch.resolve();
    return newerConfig.promise;
  });
  await configs.setActive(B);
  const second = bootstrap.reload();
  await newerFetch.promise;
  saved.resolve((await configs.find(A))!);
  await first;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'loading', entry: { url: B } });
  newerConfig.resolve(parseVodConfig('{"sites":[]}', B));
  await second;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', config: { url: B } });
});

it('drops an older saved-entry lookup before it changes the snapshot', async () => {
  const { bootstrap, configs, loadConfig } = await setup();
  const entered = deferred<void>();
  const lookup = deferred<SavedConfig | undefined>();
  const entry = await configs.find(A);
  jest.spyOn(configs, 'find').mockImplementationOnce(() => {
    entered.resolve();
    return lookup.promise;
  });
  const first = bootstrap.start();
  await entered.promise;
  await configs.setActive(B);
  await bootstrap.reload();
  lookup.resolve(entry);
  await first;
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', config: { url: B } });
  expect(loadConfig).not.toHaveBeenCalledWith(A, expect.anything());
});

it('finishes older native cleanup before activating the current config', async () => {
  const { bootstrap, configs, loadConfig } = await setup();
  const entered = deferred<void>();
  const cleanup = deferred<void>();
  const newerFetch = deferred<void>();
  let clearing = false;
  let overlapping = false;
  jest.mocked(onJarConfigLoaded).mockImplementation(async (config) => {
    if (config.spider === A) {
      clearing = true;
      entered.resolve();
      await cleanup.promise;
      clearing = false;
    } else {
      overlapping = clearing;
    }
  });
  const first = bootstrap.start();
  await entered.promise;
  loadConfig.mockImplementationOnce(async (url) => {
    newerFetch.resolve();
    return parseVodConfig('{"sites":[]}', url);
  });
  await configs.setActive(B);
  const second = bootstrap.reload();
  await newerFetch.promise;
  // Let the resolved fetch reach the activation step while the first clear is pending.
  await Promise.resolve();
  await Promise.resolve();
  cleanup.resolve();
  await Promise.all([first, second]);
  expect(overlapping).toBe(false);
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', config: { url: B } });
});

it('can activate another config after a failed persistence operation', async () => {
  const { bootstrap, configs } = await setup();
  jest.spyOn(configs, 'add').mockRejectedValueOnce(new Error('storage unavailable'));
  await bootstrap.start();
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'error', error: new Error('storage unavailable') });
  await configs.setActive(B);
  await bootstrap.reload();
  expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', config: { url: B } });
});

it('resets the home site before the config loads', async () => {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  await configs.add({ url: A });
  await configs.setActive(A);
  const settings = createSettingsStore(store);
  const order: string[] = [];
  const loadConfig = jest.fn(async (url: string) => {
    order.push('load');
    return parseVodConfig(JSON.stringify({ sites: [] }), url);
  });
  const resetHome = jest.fn(async () => {
    order.push('reset');
  });
  await createBootstrap({ configs, settings, loadConfig, resetHome }).start();
  expect(order).toEqual(['reset', 'load']);
});
