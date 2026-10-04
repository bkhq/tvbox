import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// The QuickJS native module is absent under Jest; spider tests install a node vm runtime instead.
jest.mock('./modules/quickjs', () => {
  const unavailable = () => Promise.reject(new Error('QuickJS native module is not available in Jest'));
  return {
    __esModule: true,
    default: {
      createContext: jest.fn(unavailable),
      registerModule: jest.fn(unavailable),
      evaluate: jest.fn(unavailable),
      call: jest.fn(unavailable),
      destroyContext: jest.fn(unavailable),
    },
  };
});
