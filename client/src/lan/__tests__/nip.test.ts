import { nipAddress, reachable } from '../nip';

describe('nipAddress', () => {
  it('names an IPv4 address under nip.io and keeps the port', () => {
    expect(nipAddress('http://192.168.1.5:9978')).toBe('http://192.168.1.5.nip.io:9978');
    expect(nipAddress('http://10.0.0.2')).toBe('http://10.0.0.2.nip.io');
  });

  it('leaves anything else unnamed', () => {
    for (const address of ['', 'http://tvbox.local:9978', 'https://192.168.1.5:9978', 'http://192.168.1.5:9978/x'])
      expect(nipAddress(address)).toBe('');
  });
});

describe('reachable', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is true when the page answers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    await expect(reachable('http://192.168.1.5.nip.io:9978')).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://192.168.1.5.nip.io:9978/');
  });

  it('is false when the name does not resolve or the page fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(reachable('http://192.168.1.5.nip.io:9978')).resolves.toBe(false);
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(reachable('http://192.168.1.5.nip.io:9978')).resolves.toBe(false);
  });

  it('gives up after the timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    ) as unknown as typeof fetch;
    const result = reachable('http://192.168.1.5.nip.io:9978', 500);
    jest.advanceTimersByTime(500);
    await expect(result).resolves.toBe(false);
    jest.useRealTimers();
  });
});
