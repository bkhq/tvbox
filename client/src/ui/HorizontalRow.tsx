import { FlatList, StyleSheet, Text, TVFocusGuideView, View, type ListRenderItem } from 'react-native';

import { colors, fontSize, spacing } from './theme';

export interface HorizontalRowProps<T> {
  title?: string;
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  testID?: string;
}

/**
 * Titled horizontal list. On TV the focus guide traps left/right moves at the
 * row ends and restores the last focused item when focus re-enters the row.
 */
export function HorizontalRow<T>({ title, data, renderItem, keyExtractor, testID }: HorizontalRowProps<T>) {
  return (
    <View style={styles.row} testID={testID}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight>
        <FlatList
          horizontal
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.content}
        />
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginVertical: spacing.sm,
  },
  title: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    color: colors.text,
    fontSize: fontSize.title,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: spacing.md,
  },
});
