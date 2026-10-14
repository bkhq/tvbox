import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SectionHeader } from '../SectionHeader';
import { color } from '../tokens';
import { fontFamily } from '../typography';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Text, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const style = (renderer: ReactTestRenderer) =>
  StyleSheet.flatten(renderer.root.findAll((n) => n.type === View && n.props.testID === 'header')[0]!.props.style);

describe('SectionHeader', () => {
  it('renders the h2 title alone', async () => {
    const renderer = await render(<SectionHeader testID="header" title="继续观看" />);
    const [title, ...rest] = renderer.root.findAllByType(Text);
    expect(rest).toHaveLength(0);
    expect(title!.props.children).toBe('继续观看');
    expect(StyleSheet.flatten(title!.props.style)).toMatchObject({ fontFamily: fontFamily.semiBold, color: color.text });
  });

  it('uses the h1 text style for the h1 variant', async () => {
    const renderer = await render(<SectionHeader testID="header" title="播放设置" variant="h1" caption="共 6 项" />);
    const [title, caption] = renderer.root.findAllByType(Text);
    expect(StyleSheet.flatten(title!.props.style)).toMatchObject({
      fontFamily: fontFamily.bold,
      fontSize: 40,
      lineHeight: 44,
      color: color.text,
    });
    expect(StyleSheet.flatten(caption!.props.style).color).toBe(color.text3);
  });

  it('puts the caption beside the title by default', async () => {
    const renderer = await render(<SectionHeader testID="header" title="我的收藏" caption="共 12 部" />);
    const texts = renderer.root.findAllByType(Text);
    expect(texts.map((t) => t.props.children)).toEqual(['我的收藏', '共 12 部']);
    expect(StyleSheet.flatten(texts[1]!.props.style).color).toBe(color.text3);
    expect(style(renderer)).toMatchObject({ flexDirection: 'row', alignItems: 'baseline' });
  });

  it('stacks the caption below the title', async () => {
    const renderer = await render(
      <SectionHeader testID="header" title="观看历史" caption="最近 30 天" captionPosition="below" />,
    );
    expect(style(renderer).flexDirection).toBeUndefined();
  });
});
