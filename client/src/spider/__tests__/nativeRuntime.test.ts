/**
 * Startup wiring and the native adapter. The QuickJS module is mocked in
 * jest.setup.ts; this file only checks registration and error mapping.
 */

import QuickJS from '../../../modules/quickjs';
import { getBootstrap } from '../../core/bootstrap';
import { parseSite } from '../../core/config/vodConfig';
import { findProviderFactory, getProvider } from '../../core/provider';
import { getSpiderRuntime, JsSpiderProvider, jsSpiderProviderFactory, SpiderError, SpiderTimeoutError } from '..';
import { nativeSpiderRuntime } from '../nativeRuntime';

const native = jest.mocked(QuickJS);

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('startup wiring', () => {
  it('getBootstrap installs the native runtime and the js-spider provider once', () => {
    const jsSite = parseSite({ key: 'js', name: 'js', type: 3, api: 'https://example.com/spider.js' });
    expect(findProviderFactory(jsSite)).toBeUndefined();

    getBootstrap();
    getBootstrap();

    expect(getSpiderRuntime()).toBe(nativeSpiderRuntime);
    expect(findProviderFactory(jsSite)).toBe(jsSpiderProviderFactory);
    expect(getProvider(jsSite)).toBeInstanceOf(JsSpiderProvider);
    const cmsSite = parseSite({ key: 'cms', name: 'cms', type: 1, api: 'https://example.com/api.php/provide/vod' });
    expect(getProvider(cmsSite)).not.toBeInstanceOf(JsSpiderProvider);
  });
});

describe('nativeSpiderRuntime', () => {
  it('passes calls straight through', async () => {
    native.createContext.mockResolvedValueOnce(7);
    native.call.mockResolvedValueOnce('{"a":1}');
    native.evaluate.mockResolvedValueOnce(undefined);

    await expect(nativeSpiderRuntime.createContext()).resolves.toBe(7);
    await expect(nativeSpiderRuntime.call(7, 'obj', 'home', '[true]', 500)).resolves.toBe('{"a":1}');
    await nativeSpiderRuntime.evaluate(7, 'code', 'tvbox://x.js', true, 300);

    expect(native.call).toHaveBeenLastCalledWith(7, 'obj', 'home', '[true]', 500);
    expect(native.evaluate).toHaveBeenLastCalledWith(7, 'code', 'tvbox://x.js', true, 300);
  });

  it('maps native error codes to typed errors', async () => {
    native.call.mockRejectedValueOnce(coded('ERR_QUICKJS_TIMEOUT', 'timed out'));
    native.evaluate.mockRejectedValueOnce(coded('ERR_QUICKJS_EXCEPTION', 'Error: boom\n    at x'));
    native.destroyContext.mockRejectedValueOnce(coded('ERR_QUICKJS_NO_CONTEXT', 'no context 3'));
    native.registerModule.mockRejectedValueOnce(new Error('bridge gone'));

    const timeout = nativeSpiderRuntime.call(1, 'o', 'm', '[]', 10).catch((error: unknown) => error);
    await expect(timeout).resolves.toBeInstanceOf(SpiderTimeoutError);
    await expect(nativeSpiderRuntime.evaluate(1, '', 'a.js', false, 10)).rejects.toMatchObject({
      name: 'SpiderError',
      code: 'ERR_QUICKJS_EXCEPTION',
      message: 'Error: boom\n    at x',
    });
    await expect(nativeSpiderRuntime.destroyContext(3)).rejects.toMatchObject({ code: 'ERR_QUICKJS_NO_CONTEXT' });
    const other = await nativeSpiderRuntime.registerModule(1, 'n', 's').catch((error: unknown) => error);
    expect(other).toBeInstanceOf(SpiderError);
    expect(other).toMatchObject({ code: 'ERR_SPIDER_RUNTIME', message: 'bridge gone' });
  });
});
