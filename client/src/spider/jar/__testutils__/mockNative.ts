import type { JarSpiderNative } from '../../../../modules/jarspider';

export type MockJarSpider = { [K in keyof JarSpiderNative]: jest.Mock };

/** JarSpider native module double; every call resolves an empty value unless overridden. */
export function mockJarSpider(): MockJarSpider {
  return {
    setProxyPort: jest.fn(),
    loadJar: jest.fn(async () => true),
    setRecent: jest.fn(),
    initSpider: jest.fn(async () => undefined),
    homeContent: jest.fn(async () => ''),
    homeVideoContent: jest.fn(async () => ''),
    categoryContent: jest.fn(async () => ''),
    detailContent: jest.fn(async () => ''),
    searchContent: jest.fn(async () => ''),
    playerContent: jest.fn(async () => ''),
    proxy: jest.fn(async () => null),
    jsonExt: jest.fn(async () => '{}'),
    jsonExtMix: jest.fn(async () => '{}'),
    destroySpider: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

export function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
