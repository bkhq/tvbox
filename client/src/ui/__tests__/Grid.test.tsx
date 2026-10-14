import { FlatList, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Grid } from '../Grid';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Text];

const data = Array.from({ length: 20 }, (_, i) => `item-${i}`);
const renderItem = ({ item }: { item: string }) => <Text>{item}</Text>;

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const list = (renderer: ReactTestRenderer): ReactTestInstance => renderer.root.findByType(FlatList);

function expectWindow(node: ReactTestInstance, columns: number) {
  expect(node.props).toMatchObject({
    numColumns: columns,
    initialNumToRender: columns * 3,
    maxToRenderPerBatch: columns * 2,
    windowSize: 5,
    onEndReachedThreshold: 0.5,
  });
}

describe('Grid', () => {
  it('uses 7 poster columns by default and 5 for wide cards', async () => {
    const poster = await render(<Grid data={data} keyExtractor={(item) => item} renderItem={renderItem} />);
    expectWindow(list(poster), 7);

    const wide = await render(
      <Grid variant="wide" data={data} keyExtractor={(item) => item} renderItem={renderItem} />,
    );
    expectWindow(list(wide), 5);
  });

  it('honours a column override and remounts when it changes', async () => {
    const props = { data, keyExtractor: (item: string) => item, renderItem };
    const renderer = await render(<Grid {...props} columns={4} />);
    const first = list(renderer);
    expectWindow(first, 4);

    await act(async () => renderer.update(<Grid {...props} columns={6} />));
    expectWindow(list(renderer), 6);
    expect(list(renderer)).not.toBe(first);
  });

  it('pads by the safe area with a focus bleed and gaps the cards by 24', async () => {
    const renderer = await render(<Grid data={data} keyExtractor={(item) => item} renderItem={renderItem} />);
    expect(StyleSheet.flatten(list(renderer).props.contentContainerStyle)).toEqual({
      paddingHorizontal: 96,
      paddingVertical: 16,
      gap: 24,
    });
    expect(StyleSheet.flatten(list(renderer).props.columnWrapperStyle)).toEqual({ gap: 24 });

    const single = await render(<Grid columns={1} data={data} keyExtractor={(item) => item} renderItem={renderItem} />);
    expect(list(single).props.columnWrapperStyle).toBeUndefined();
  });

  it('takes a custom inset and gap in design px', async () => {
    const renderer = await render(
      <Grid inset={40} gap={16} data={data} keyExtractor={(item) => item} renderItem={renderItem} />,
    );
    expect(StyleSheet.flatten(list(renderer).props.contentContainerStyle)).toEqual({
      paddingHorizontal: 40,
      paddingVertical: 16,
      gap: 16,
    });
    expect(StyleSheet.flatten(list(renderer).props.columnWrapperStyle)).toEqual({ gap: 16 });
  });

  it('passes the list props through', async () => {
    const onEndReached = jest.fn();
    const header = <Text>header</Text>;
    const renderer = await render(
      <Grid
        testID="grid"
        data={data}
        keyExtractor={(item) => item}
        renderItem={renderItem}
        onEndReached={onEndReached}
        ListHeaderComponent={header}
      />,
    );
    expect(list(renderer).props).toMatchObject({ testID: 'grid', data, onEndReached, ListHeaderComponent: header });
  });
});
