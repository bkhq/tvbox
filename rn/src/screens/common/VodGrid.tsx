import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions } from 'react-native';

import type { Vod } from '../../core/types';
import { colors, FocusableCard, FocusGrid, fontSize, spacing, useLayout } from '../../ui';

export interface VodGridProps {
  items: readonly Vod[];
  loading?: boolean;
  onEndReached?: () => void;
  onPressVod: (vod: Vod) => void;
  /** Gives the first card the initial TV focus. */
  preferFirstFocus?: boolean;
  ListHeaderComponent?: ReactElement | null;
}

export function VodGrid({ items, loading, onEndReached, onPressVod, preferFirstFocus, ListHeaderComponent }: VodGridProps) {
  const { columns } = useLayout();
  const { width } = useWindowDimensions();
  // Grid padding on both sides, card margin on both sides of every card.
  const cardWidth = Math.max(80, Math.floor((width - spacing.md * 2) / columns) - spacing.xs * 2);
  return (
    <FocusGrid
      testID="vod-grid"
      data={items}
      columns={columns}
      keyExtractor={(vod, index) => `${vod.vod_id}-${index}`}
      onEndReached={onEndReached}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={loading ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
      ListEmptyComponent={loading ? null : <Text style={styles.empty}>暂无内容</Text>}
      renderItem={({ item, index }) => (
        <FocusableCard
          testID={`vod-card-${item.vod_id}`}
          title={item.vod_name}
          subtitle={item.vod_remarks}
          poster={item.vod_pic}
          width={cardWidth}
          hasTVPreferredFocus={preferFirstFocus && index === 0}
          onPress={() => onPressVod(item)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  footer: {
    marginVertical: spacing.lg,
  },
  empty: {
    marginVertical: spacing.xl,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    textAlign: 'center',
  },
});
