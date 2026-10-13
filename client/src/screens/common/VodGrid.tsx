import { memo, type ReactElement, useCallback, useLayoutEffect, useRef } from 'react';
import { ActivityIndicator, type ListRenderItem, StyleSheet, Text, useWindowDimensions } from 'react-native';

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

interface VodCardProps {
  vod: Vod;
  width: number;
  preferFocus: boolean;
  onPressVod: (vod: Vod) => void;
}

// Memoized so appending results or a parent re-render leaves the existing cards alone.
const VodCard = memo(function VodCard({ vod, width, preferFocus, onPressVod }: VodCardProps) {
  const onPress = useCallback(() => onPressVod(vod), [onPressVod, vod]);
  return (
    <FocusableCard
      testID={`vod-card-${vod.vod_id}`}
      title={vod.vod_name}
      subtitle={vod.vod_remarks}
      poster={vod.vod_pic}
      width={width}
      hasTVPreferredFocus={preferFocus}
      onPress={onPress}
    />
  );
});

export function VodGrid({ items, loading, onEndReached, onPressVod, preferFirstFocus, ListHeaderComponent }: VodGridProps) {
  const { columns } = useLayout();
  const { width } = useWindowDimensions();
  // Grid padding on both sides, card margin on both sides of every card.
  const cardWidth = Math.max(80, Math.floor((width - spacing.md * 2) / columns) - spacing.xs * 2);
  // Callers pass a new handler on every render; the cards get one stable function that calls the latest.
  const pressRef = useRef(onPressVod);
  useLayoutEffect(() => {
    pressRef.current = onPressVod;
  });
  const press = useCallback((vod: Vod) => pressRef.current(vod), []);
  const renderItem = useCallback<ListRenderItem<Vod>>(
    ({ item, index }) => (
      <VodCard vod={item} width={cardWidth} preferFocus={preferFirstFocus === true && index === 0} onPressVod={press} />
    ),
    [cardWidth, preferFirstFocus, press],
  );
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
      renderItem={renderItem}
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
