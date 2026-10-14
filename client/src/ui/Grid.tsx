import { type ReactElement, useMemo } from 'react';
import { FlatList, type ListRenderItem } from 'react-native';

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
  const styles = useMemo(
    () => ({
      // Inset on the sides; the vertical bleed keeps the focus zoom of the edge rows unclipped.
      content: { paddingHorizontal: s(inset), paddingVertical: s(focus.bleed), gap: s(gap) },
      columns: { gap: s(gap) },
    }),
    [s, inset, gap],
  );
  return (
    <FlatList
      // FlatList cannot change numColumns in place; remount on change.
      key={`grid-${numColumns}`}
      numColumns={numColumns}
      // Same window as FocusGrid: only the rows the focus can reach next.
      initialNumToRender={numColumns * 3}
      maxToRenderPerBatch={numColumns * 2}
      windowSize={5}
      onEndReachedThreshold={0.5}
      style={listStyle}
      contentContainerStyle={styles.content}
      // FlatList rejects columnWrapperStyle for a single column.
      columnWrapperStyle={numColumns > 1 ? styles.columns : undefined}
      {...props}
    />
  );
}

// The list is the scroll container: bounded by its parent and clipping, so focusing an off-screen card scrolls it in.
// The content padding carries the focus bleed instead of an unclipped overflow.
const listStyle = { flex: 1 };
