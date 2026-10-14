import { type ReactElement, useMemo, useState } from 'react';
import { FlatList, type LayoutChangeEvent, type ListRenderItem, View } from 'react-native';

import { useScale } from './scale';
import { card, focus, safeArea } from './tokens';

export type GridVariant = 'poster' | 'wide';

export interface GridProps<T> {
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  /** poster: 7 columns of 2:3 cards; wide: 5 columns of 16:9 cards. */
  variant?: GridVariant;
  /** Overrides the column count of the variant. */
  columns?: number;
  /** Horizontal padding in design px; defaults to the safe area. */
  inset?: number;
  /** Gap between rows and columns in design px. */
  gap?: number;
  /** Called near the end of the list to load the next page. */
  onEndReached?: () => void;
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  testID?: string;
}

const variantColumns = { poster: card.posterColumns, wide: card.wideColumns } as const;

export function Grid<T>({
  variant = 'poster',
  columns,
  inset = safeArea.horizontal,
  gap = card.rowGap,
  ...props
}: GridProps<T>) {
  const { s } = useScale();
  const numColumns = columns ?? variantColumns[variant];
  // On TV the list wraps its scroll view in an unstyled, content-sized focus guide, so flex cannot bound it:
  // measure the space the parent gives the grid and pin the list to that height so it scrolls to the focus.
  const [height, setHeight] = useState<number>();
  const onLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);
  const styles = useMemo(
    () => ({
      // Inset on the sides; the list clips, so the vertical bleed fits the zoomed poster plus its ring.
      content: { paddingHorizontal: s(inset), paddingVertical: s(focus.bleed + focus.borderWidth), gap: s(gap) },
      columns: { gap: s(gap) },
    }),
    [s, inset, gap],
  );
  return (
    <View style={frameStyle} onLayout={onLayout}>
      <FlatList
        // FlatList cannot change numColumns in place; remount on change.
        key={`grid-${numColumns}`}
        numColumns={numColumns}
        // Same window as FocusGrid: only the rows the focus can reach next.
        initialNumToRender={numColumns * 3}
        maxToRenderPerBatch={numColumns * 2}
        windowSize={5}
        onEndReachedThreshold={0.5}
        // TV: D-pad moves straight to the next card and scrolls it in, instead of first paging by half a screen.
        snapToAlignment="item"
        style={height === undefined ? undefined : { height }}
        contentContainerStyle={styles.content}
        // FlatList rejects columnWrapperStyle for a single column.
        columnWrapperStyle={numColumns > 1 ? styles.columns : undefined}
        {...props}
      />
    </View>
  );
}

const frameStyle = { flex: 1 };
