import { PixelRatio, StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DESIGN_WIDTH, makeScaler, scaleFor, useScale, useScaledStyles, type Scaler } from '../scale';

const mockDimensions = { width: 1920, height: 1080 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockDimensions, scale: 1, fontScale: 1 }),
}));

describe('scaleFor', () => {
  it('maps the 1920 px design width onto the window width', () => {
    expect(DESIGN_WIDTH).toBe(1920);
    expect(scaleFor(1920)).toBe(1);
    expect(scaleFor(960)).toBe(0.5);
    expect(scaleFor(390)).toBeCloseTo(0.203125);
  });
});

describe('makeScaler', () => {
  it('rounds to the nearest physical pixel', () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2);
    try {
      const s = makeScaler(0.5);
      expect(s(224)).toBe(112);
      expect(makeScaler(1 / 3)(10)).toBe(3.5);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useScale / useScaledStyles', () => {
  it('rebuilds the sheet only when the window width changes', async () => {
    const factory = jest.fn((s: Scaler) => ({ card: { width: s(224) } }));
    let scale = 0;
    let styles: { card: { width: number } } | undefined;
    function Probe() {
      scale = useScale().scale;
      styles = useScaledStyles(factory);
      return null;
    }
    const createSpy = jest.spyOn(StyleSheet, 'create');
    let renderer!: ReactTestRenderer;

    Object.assign(mockDimensions, { width: 960, height: 540 });
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(scale).toBe(0.5);
    expect(styles!.card.width).toBe(112);

    await act(async () => renderer.update(<Probe />));
    expect(factory).toHaveBeenCalledTimes(1);

    Object.assign(mockDimensions, { width: 1920, height: 1080 });
    await act(async () => renderer.update(<Probe />));
    expect(scale).toBe(1);
    expect(styles!.card.width).toBe(224);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledTimes(2);
    createSpy.mockRestore();
  });
});
