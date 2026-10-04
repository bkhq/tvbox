import { getAppConfig } from '../appConfig';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.2.3',
      android: { versionCode: 42 },
      extra: { workerUrl: 'https://tvbox.example.workers.dev/' },
    },
  },
}));

describe('getAppConfig', () => {
  it('reads worker URL and version from the Expo config', () => {
    expect(getAppConfig()).toEqual({
      workerUrl: 'https://tvbox.example.workers.dev',
      versionName: '1.2.3',
      versionCode: 42,
    });
  });
});
