import { decodeBase64, decodeConfigText, fixRelativeUrls, resolveRelative } from '../decode';

describe('resolveRelative', () => {
  it('resolves ./ and ../ like UriUtil.resolve', () => {
    expect(resolveRelative('https://h.com/a/b/c.json?x=1#f', './')).toBe('https://h.com/a/b/');
    expect(resolveRelative('https://h.com/a/b/c.json', '../')).toBe('https://h.com/a/');
    expect(resolveRelative('https://h.com/c.json', '../')).toBe('https://h.com/');
    expect(resolveRelative('https://h.com', './')).toBe('https://h.com/');
    expect(resolveRelative('https://h.com/a/', './')).toBe('https://h.com/a/');
  });
});

describe('fixRelativeUrls', () => {
  it('rewrites relative references and protects .js query strings', () => {
    const url = 'https://h.com/a/b/config.json';
    const text = '{\n"a":"./x.json",\n"b":"../y.json",\n"c":"./s.js?ext=./r/../q.json"\n}';
    expect(JSON.parse(fixRelativeUrls(url, text))).toEqual({
      a: 'https://h.com/a/b/x.json',
      b: 'https://h.com/a/y.json',
      c: 'https://h.com/a/b/s.js?ext=./r/../q.json',
    });
  });
});

describe('decodeConfigText', () => {
  it('passes plain JSON through the URL fix', () => {
    expect(decodeConfigText('https://h.com/c.json', '{"w":"./w.jpg"}')).toBe('{"w":"https://h.com/w.jpg"}');
  });

  it('decodes UTF-8 base64', () => {
    expect(decodeBase64('5Lit5paHIOKCrCDwn5iA\n')).toBe('中文 € 😀');
  });
});
