import { FlatList, StyleSheet, Text, TVFocusGuideView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Row } from '../Row';
import { SectionHeader } from '../SectionHeader';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Text];

const data = ['a', 'b', 'c'];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

describe('Row', () => {
  it('renders the header inset by the safe area and every item', async () => {
    const renderer = await render(
      <Row
        title="继续观看"
        caption="3 部"
        data={data}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
      />,
    );
    const header = renderer.root.findByType(SectionHeader);
    expect(header.props).toMatchObject({ title: '继续观看', caption: '3 部' });
    expect(StyleSheet.flatten(header.props.style)).toMatchObject({ marginHorizontal: 96 });
    // A focused poster overhangs its slot by 13.44 + a 4.32 ring; with the 16 bleed this leaves 8 below the title.
    const { marginBottom } = StyleSheet.flatten(header.props.style);
    expect(marginBottom).toBe(10);
    expect(Number(marginBottom) + 16 - ((1.08 - 1) / 2) * 336 - 4 * 1.08).toBeGreaterThanOrEqual(8);
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('bleeds to the edge with room for the focus zoom and keeps the focus trap', async () => {
    const renderer = await render(
      <Row data={data} keyExtractor={(item) => item} renderItem={({ item }) => <Text>{item}</Text>} />,
    );
    expect(renderer.root.findAllByType(SectionHeader)).toHaveLength(0);
    const list = renderer.root.findByType(FlatList);
    expect(list.props).toMatchObject({ horizontal: true, showsHorizontalScrollIndicator: false });
    expect(list.props.initialNumToRender).toBeLessThanOrEqual(8);
    expect(list.props.maxToRenderPerBatch).toBeLessThanOrEqual(8);
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toEqual({
      paddingHorizontal: 96,
      paddingVertical: 16,
      gap: 24,
    });
    expect(StyleSheet.flatten(list.props.style)).toMatchObject({ overflow: 'visible' });
    expect(renderer.root.findByType(TVFocusGuideView).props).toMatchObject({
      autoFocus: true,
      trapFocusLeft: true,
      trapFocusRight: true,
    });
  });
});
