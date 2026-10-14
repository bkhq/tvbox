import { memo, type ReactElement, useCallback, useLayoutEffect, useRef } from 'react';
import { ActivityIndicator, type ListRenderItem, Text } from 'react-native';

import type { Vod } from '../../core/types';
import {
  card,
  color,
  DESIGN_WIDTH,
  Grid,
  PosterCard,
  safeArea,
  scaledText,
  space,
  useScaledStyles,
  type Scaler,
} from '../../ui';
import { displayRemarks } from './remarks';

export interface VodGridProps {
  items: readonly Vod[];
  loading?: boolean;
  onEndReached?: () => void;
  onPressVod: (vod: Vod) => void;
  /** Gives the first card the initial TV focus. */
  preferFirstFocus?: boolean;
  ListHeaderComponent?: ReactElement | null;
  /** Empty-state element shown when not loading; defaults to "暂无内容". */
  ListEmptyComponent?: ReactElement | null;
  /** Cards per row; defaults to the 7-column poster grid. */
  columns?: number;
  /** Width of the grid container in design px; defaults to the full design width. */
  width?: number;
  /** Second line under the title; defaults to vod_remarks. */
  metaOf?: (vod: Vod) => string | undefined;
  /** Corner tag on the poster; none by default. */
  badgeOf?: (vod: Vod) => string | undefined;
  testID?: string;
}

/** Card width in design px that fills `width` minus the safe area with `columns` cards and row gaps. */
export function posterWidth(columns: number, width: number = DESIGN_WIDTH): number {
  if (columns === card.posterColumns && width === DESIGN_WIDTH) return card.poster.width;
  const available = width - safeArea.horizontal * 2 - card.rowGap * (columns - 1);
  return Math.max(80, Math.floor(available / columns));
}

const remarksOf = (vod: Vod) => displayRemarks(vod.vod_remarks);
const noBadge = () => undefined;

interface VodCardProps {
  vod: Vod;
  width: number;
  meta?: string;
  badge?: string;
  preferFocus: boolean;
  onPressVod: (vod: Vod) => void;
}

// Memoized so appending results or a parent re-render leaves the existing cards alone.
const VodCard = memo(function VodCard({ vod, width, meta, badge, preferFocus, onPressVod }: VodCardProps) {
  const onPress = useCallback(() => onPressVod(vod), [onPressVod, vod]);
  return (
    <PosterCard
      testID={`vod-card-${vod.vod_id}`}
      title={vod.vod_name}
      meta={meta}
      badge={badge}
      poster={vod.vod_pic}
      width={width}
      hasTVPreferredFocus={preferFocus}
      onPress={onPress}
    />
  );
});

export function VodGrid({
  items,
  loading,
  onEndReached,
  onPressVod,
  preferFirstFocus,
  ListHeaderComponent,
  ListEmptyComponent,
  columns = card.posterColumns,
  width,
  metaOf = remarksOf,
  badgeOf = noBadge,
  testID = 'vod-grid',
}: VodGridProps) {
  const styles = useScaledStyles(makeStyles);
  const cardWidth = posterWidth(columns, width);
  // Callers pass a new handler on every render; the cards get one stable function that calls the latest.
  const pressRef = useRef(onPressVod);
  useLayoutEffect(() => {
    pressRef.current = onPressVod;
  });
  const press = useCallback((vod: Vod) => pressRef.current(vod), []);
  const renderItem = useCallback<ListRenderItem<Vod>>(
    ({ item, index }) => (
      <VodCard
        vod={item}
        width={cardWidth}
        meta={metaOf(item)}
        badge={badgeOf(item)}
        preferFocus={preferFirstFocus === true && index === 0}
        onPressVod={press}
      />
    ),
    [cardWidth, metaOf, badgeOf, preferFirstFocus, press],
  );
  return (
    <Grid
      testID={testID}
      data={items}
      columns={columns}
      keyExtractor={(vod, index) => `${vod.vod_id}-${index}`}
      onEndReached={onEndReached}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={loading ? <ActivityIndicator style={styles.footer} color={color.accent} /> : null}
      ListEmptyComponent={loading ? null : (ListEmptyComponent ?? <Text style={styles.empty}>暂无内容</Text>)}
      renderItem={renderItem}
    />
  );
}

const makeStyles = (s: Scaler) => ({
  footer: { marginVertical: s(space.lg) },
  empty: { ...scaledText(s).body, marginVertical: s(space.xl), color: color.text2, textAlign: 'center' as const },
});
