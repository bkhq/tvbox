import { fontFamily, scaledText, tabular, text } from '../typography';

describe('typography', () => {
  it('uses the per-weight Outfit family without fontWeight', () => {
    expect(text.display).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 76, lineHeight: 96 });
    expect(text.displaySm).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 57, lineHeight: 66 });
    expect(text.h1).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 48, lineHeight: 56 });
    expect(text.h2).toEqual({ fontFamily: 'Outfit-SemiBold', fontSize: 38, lineHeight: 46 });
    expect(text.body).toEqual({ fontFamily: 'Outfit-Medium', fontSize: 31, lineHeight: 38 });
    expect(text.label).toEqual({ fontFamily: 'Outfit-Medium', fontSize: 29, lineHeight: 36 });
    expect(text.caption).toEqual({ fontFamily: fontFamily.medium, fontSize: 25, lineHeight: 32 });
  });

  it('scales sizes and line heights with s', () => {
    const scaled = scaledText((px) => px / 2);
    expect(scaled.h1).toEqual({ fontFamily: 'Outfit-Bold', fontSize: 24, lineHeight: 28 });
    expect(scaled.caption.fontSize).toBe(12.5);
    expect(Object.keys(scaled)).toEqual(Object.keys(text));
  });

  it('exports tabular digits', () => {
    expect(tabular).toEqual({ fontVariant: ['tabular-nums'] });
  });
});
