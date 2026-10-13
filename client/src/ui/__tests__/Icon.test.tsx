import Svg from 'react-native-svg';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Icon, iconNames } from '../Icon';
import { color } from '../tokens';

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const svg = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === Svg && n.props.testID === 'icon')[0]!;

describe('Icon', () => {
  it.each(iconNames)('renders %s', async (name) => {
    const renderer = await render(<Icon testID="icon" name={name} />);
    expect(renderer.toJSON()).not.toBeNull();
    expect(svg(renderer).props.color).toBe(color.text);
  });

  it('covers the icons the mockups use', () => {
    expect(iconNames).toEqual(
      expect.arrayContaining([
        'search',
        'settings',
        'phone',
        'switch',
        'back',
        'heart',
        'heartFilled',
        'play',
        'pause',
        'history',
        'star',
        'chevronRight',
      ]),
    );
  });

  it('scales the design size and applies the colour', async () => {
    const small = await render(<Icon testID="icon" name="play" size={24} color={color.accent} />);
    const large = await render(<Icon testID="icon" name="play" size={48} />);
    expect(svg(small).props.color).toBe(color.accent);
    expect(svg(large).props.width).toBeCloseTo((svg(small).props.width as number) * 2, 0);
    expect(svg(large).props.width).toBe(svg(large).props.height);
  });
});
