import { colors, focusScale, fontSize, radius, spacing, theme } from '../theme';
import { card, color, focus, radii, safeArea, space, type } from '../tokens';

describe('design tokens', () => {
  it('match the 1080p design values', () => {
    expect(color).toMatchObject({
      bg: '#0B0E14',
      surface: '#151A24',
      surface2: '#1E2532',
      text: '#F2F4F8',
      text2: '#AEB7C7',
      text3: '#8C96A8',
      accent: '#F2B134',
      live: '#C8313B',
      buttonFill: 'rgba(255,255,255,0.14)',
      focusBorder: '#FFFFFF',
    });
    expect(type.display).toEqual({ fontSize: 88, lineHeight: 88, fontWeight: 700 });
    expect(type.displaySm).toEqual({ fontSize: 72, lineHeight: 72, fontWeight: 700 });
    expect(type.h1).toEqual({ fontSize: 40, lineHeight: 44, fontWeight: 700 });
    expect(type.h2).toEqual({ fontSize: 32, lineHeight: 38, fontWeight: 600 });
    expect(type.body).toEqual({ fontSize: 28, lineHeight: 39, fontWeight: 500 });
    expect(type.label).toEqual({ fontSize: 24, lineHeight: 34, fontWeight: 500 });
    expect(type.caption.fontSize).toBe(20);
    expect(Object.values(space)).toEqual([8, 16, 24, 40, 64, 96]);
    expect(radii).toEqual({ tag: 6, card: 10, button: 14, round: 9999 });
    expect(safeArea).toEqual({ horizontal: 96, vertical: 56 });
    expect(focus).toMatchObject({
      scale: 1.08,
      pressedScale: 1.02,
      borderWidth: 4,
      borderColor: '#FFFFFF',
      springMs: 180,
      bleed: 16,
    });
    expect(card).toEqual({
      poster: { width: 224, height: 336 },
      wide: { width: 352, height: 198 },
      channel: { width: 160, height: 90 },
      rowGap: 24,
      posterColumns: 7,
      wideColumns: 5,
    });
  });
});

describe('legacy theme', () => {
  it('keeps every export and key, derived from the tokens at 960 dp', () => {
    expect(colors).toEqual({
      background: '#0B0E14',
      surface: '#151A24',
      surfaceFocused: '#1E2532',
      primary: '#F2B134',
      text: '#F2F4F8',
      textSecondary: '#AEB7C7',
      border: 'transparent',
      focusBorder: '#FFFFFF',
      remarkBackground: 'rgba(0, 0, 0, 0.6)',
    });
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 20, xl: 32 });
    expect(fontSize).toEqual({ caption: 10, body: 14, title: 16, heading: 20, display: 36 });
    expect(radius).toEqual({ sm: 3, md: 5 });
    expect(focusScale).toBe(1.08);
    expect(theme).toEqual({ colors, spacing, fontSize, radius, focusScale });
  });
});
