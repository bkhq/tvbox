import { FlatList, TVFocusGuideView, View, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';

import { useScaledStyles, type Scaler } from './scale';
import { SectionHeader } from './SectionHeader';
import { card, focus, safeArea } from './tokens';

export interface RowProps<T> {
  title?: string;
  /** Note beside the title, e.g. an item count. */
  caption?: string;
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Horizontal row that bleeds to the screen edge: the header and first card sit on the safe
 * area, and the list keeps room around the cards for the focus zoom. On TV the focus guide
 * traps left/right moves at the row ends and restores the last focused item on re-entry.
 */
export function Row<T>({ title, caption, data, renderItem, keyExtractor, style, testID }: RowProps<T>) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} style={style}>
      {title ? <SectionHeader title={title} caption={caption} style={styles.header} /> : null}
      <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight>
        <FlatList
          horizontal
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showsHorizontalScrollIndicator={false}
          // A row only needs the cards on screen plus the next few the focus can reach.
          initialNumToRender={8}
          maxToRenderPerBatch={4}
          windowSize={3}
          style={styles.list}
          contentContainerStyle={styles.content}
        />
      </TVFocusGuideView>
    </View>
  );
}

/**
 * Header-to-list space on top of the list's bleed: a focused poster (the tallest card) grows by
 * (1.08 - 1) / 2 * 336 = 13.44 above its slot and its 4 ring scales to 4.32; with 8 clearance from the
 * title that needs 26, of which the bleed gives 16.
 */
const HEADER_GAP =
  Math.ceil(((focus.scale - 1) / 2) * card.poster.height + focus.borderWidth * focus.scale + 8) - focus.bleed;

const makeStyles = (s: Scaler) => ({
  header: { marginHorizontal: s(safeArea.horizontal), marginBottom: s(HEADER_GAP) },
  list: { overflow: 'visible' as const },
  content: { paddingHorizontal: s(safeArea.horizontal), paddingVertical: s(focus.bleed), gap: s(card.rowGap) },
});
