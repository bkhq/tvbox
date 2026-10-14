import { fontFamily, scaledText, tabular, text } from '../typography';

describe('typography', () => {
  it('uses the per-weight Outfit family without fontWeight', () => {
    expect(text.display).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 88, lineHeight: 88 });
    expect(text.displaySm).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 72, lineHeight: 72 });
    expect(text.h1).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 44, lineHeight: 52 });
    expect(text.h2).toEqual({ fontFamily: 'Outfit-SemiBold', fontSize: 36, lineHeight: 46 });
    expect(text.body).toEqual({ fontFamily: 'Outfit-Medium', fontSize: 32, lineHeight: 44 });
    expect(text.label).toEqual({ fontFamily: 'Outfit-Medium', fontSize: 28, lineHeight: 38 });
    expect(text.caption).toEqual({ fontFamily: fontFamily.medium, fontSize: 24, lineHeight: 32 });
  });

  it('scales sizes and line heights with s', () => {
    const scaled = scaledText((px) => px / 2);
    expect(scaled.h1).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 22, lineHeight: 26 });
    expect(scaled.caption.fontSize).toBe(12);
    expect(Object.keys(scaled)).toEqual(Object.keys(text));
  });

  it('exports tabular digits', () => {
    expect(tabular).toEqual({ fontVariant: ['tabular-nums'] });
  });
});
