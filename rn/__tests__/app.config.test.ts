import type { ConfigContext, ExpoConfig } from 'expo/config';

type ConfigFn = (ctx: ConfigContext) => ExpoConfig;

function loadConfig(env: Record<string, string | undefined>): ExpoConfig {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      const build = jest.requireActual<{ default: ConfigFn }>('../app.config').default;
      config = build({ config: {} } as ConfigContext);
    });
    return config!;
  } finally {
    process.env = saved;
  }
}

describe('app.config versioning', () => {
  it('falls back to 1.0.0 / 1 when the env is unset or blank', () => {
    for (const env of [{ VERSION_NAME: undefined, VERSION_CODE: undefined }, { VERSION_NAME: '', VERSION_CODE: ' ' }]) {
      const config = loadConfig(env);
      expect(config.version).toBe('1.0.0');
      expect(config.android?.versionCode).toBe(1);
      expect(config.ios?.buildNumber).toBe('1');
    }
  });

  it('takes the version from VERSION_NAME and VERSION_CODE', () => {
    const config = loadConfig({ VERSION_NAME: '1.2.3', VERSION_CODE: '10203' });
    expect(config.version).toBe('1.2.3');
    expect(config.android?.versionCode).toBe(10203);
    expect(config.ios?.buildNumber).toBe('10203');
  });

  it.each(['abc', '1.5', '0', '-3', '12a'])('rejects VERSION_CODE=%s', (code) => {
    expect(() => loadConfig({ VERSION_CODE: code })).toThrow('VERSION_CODE must be a positive integer');
  });
});

describe('app.config network policy', () => {
  it('allows plain http on Android and iOS', () => {
    const config = loadConfig({});
    const buildProperties = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    ) as [string, { android?: { usesCleartextTraffic?: boolean } }] | undefined;
    expect(buildProperties?.[1].android?.usesCleartextTraffic).toBe(true);
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
  });
});

describe('app.config Android permissions', () => {
  it('declares what the Java app had and the RN app still uses', () => {
    const { permissions, blockedPermissions } = loadConfig({}).android ?? {};
    expect(permissions).toEqual(
      expect.arrayContaining(['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.POST_NOTIFICATIONS']),
    );
    expect(blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']),
    );
  });
});
