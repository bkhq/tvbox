import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Icon } from '../Icon';
import { Logo } from '../Logo';
import { color } from '../tokens';
import { fontFamily } from '../typography';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Text];

describe('Logo', () => {
  it('renders the accent mark and the 星幕 wordmark', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Logo />);
    });
    expect(renderer.root.findByType(Icon).props).toMatchObject({ name: 'logo', size: 48, color: color.accent });
    const word = renderer.root.findByType(Text);
    expect(word.props.children).toBe('星幕');
    expect(StyleSheet.flatten(word.props.style)).toMatchObject({
      fontFamily: fontFamily.bold,
      fontSize: 42,
      color: color.text,
    });
    expect(StyleSheet.flatten(word.props.style).letterSpacing).toBeCloseTo(2.52);
  });
});
