import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';

import { computeLayout, useLayout, type Layout } from '../useLayout';

const mockDimensions = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockDimensions, scale: 1, fontScale: 1 }),
}));

function renderLayout(): Layout {
  let result: Layout | undefined;
  function Probe() {
    result = useLayout();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return result!;
}

describe('useLayout', () => {
  const originalIsTV = Platform.isTV;
  afterEach(() => {
    Object.defineProperty(Platform, 'isTV', { value: originalIsTV, configurable: true });
  });

  it('reports a phone in portrait', () => {
    Object.defineProperty(Platform, 'isTV', { value: false, configurable: true });
    Object.assign(mockDimensions, { width: 390, height: 844 });
    expect(renderLayout()).toEqual({ isTV: false, isPhone: true, isTablet: false, columns: 3, scale: 1 });
  });

  it('reports a TV with scale from the window width', () => {
    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    Object.assign(mockDimensions, { width: 1920, height: 1080 });
    expect(renderLayout()).toEqual({ isTV: true, isPhone: false, isTablet: false, columns: 6, scale: 2 });
  });
});

describe('computeLayout', () => {
  it('detects tablets by the short side', () => {
    expect(computeLayout(1024, 768, false)).toMatchObject({ isTablet: true, isPhone: false, columns: 6 });
    expect(computeLayout(768, 1024, false)).toMatchObject({ isTablet: true, columns: 4 });
  });

  it('uses more columns for a landscape phone', () => {
    expect(computeLayout(844, 390, false)).toMatchObject({ isPhone: true, columns: 5 });
  });

  it('never scales a TV below 1', () => {
    expect(computeLayout(960, 540, true).scale).toBe(1);
  });
});
