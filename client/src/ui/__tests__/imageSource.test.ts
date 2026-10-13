import { imageSource } from '../imageSource';

describe('imageSource', () => {
  it('returns undefined for an empty url', () => {
    expect(imageSource(undefined)).toBeUndefined();
    expect(imageSource('')).toBeUndefined();
    expect(imageSource('  ')).toBeUndefined();
  });

  it('passes a plain url through without headers', () => {
    expect(imageSource('https://img.example.com/a.jpg')).toEqual({ uri: 'https://img.example.com/a.jpg' });
  });

  it('turns @Referer and @User-Agent suffixes into headers', () => {
    expect(
      imageSource('https://img9.doubanio.com/p.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Linux)'),
    ).toEqual([
      {
        uri: 'https://img9.doubanio.com/p.jpg',
        headers: { Referer: 'https://api.douban.com/', 'User-Agent': 'Mozilla/5.0 (Linux)' },
      },
    ]);
  });

  it('turns @Cookie into a header', () => {
    expect(imageSource('http://a/b.png@Cookie=k=v')).toEqual([{ uri: 'http://a/b.png', headers: { Cookie: 'k=v' } }]);
  });

  it('reads @Headers as a JSON object', () => {
    expect(imageSource('http://a/b.png@Headers={"referer":"http://r/","x-k":"1"}')).toEqual([
      { uri: 'http://a/b.png', headers: { referer: 'http://r/', 'x-k': '1' } },
    ]);
  });

  it('ignores a malformed @Headers value but still strips the suffix', () => {
    expect(imageSource('http://a/b.png@Headers={bad')).toEqual([{ uri: 'http://a/b.png', headers: {} }]);
  });

  it('keeps an @ that is not a known option', () => {
    expect(imageSource('http://a/b@2x.png')).toEqual({ uri: 'http://a/b@2x.png' });
  });

  it('leaves data urls alone', () => {
    expect(imageSource('data:image/png;base64,AAA@Referer=x')).toEqual({ uri: 'data:image/png;base64,AAA@Referer=x' });
  });
});
