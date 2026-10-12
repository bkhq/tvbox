import type { ReactElement } from 'react';
import { FlatList, StyleSheet, type ListRenderItem } from 'react-native';

import { spacing } from './theme';
import { useLayout } from './useLayout';

export interface FocusGridProps<T> {
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  /** Overrides the column count derived from useLayout(). */
  columns?: number;
  /** Called near the end of the list to load the next page. */
  onEndReached?: () => void;
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  testID?: string;
}

export function FocusGrid<T>({ columns, ...props }: FocusGridProps<T>) {
  const layout = useLayout();
  const numColumns = columns ?? layout.columns;
  return (
    <FlatList
      // FlatList cannot change numColumns in place; remount on change.
      key={`grid-${numColumns}`}
      numColumns={numColumns}
      onEndReachedThreshold={0.5}
      contentContainerStyle={styles.content}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
});
