import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { Vod } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports the search screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { Chip, color, safeArea, scaledText, space, useScaledStyles, type Scaler } from '../../ui';
import { openVod, VodGrid } from '../common';
import type { SearchProgress, SiteGroup } from './searchSites';

/** Filter key of the aggregated view. */
const ALL = '';
const COLUMNS = 4;
/** Width of four 224 px posters with their row gaps, as in the design. */
export const RESULTS_WIDTH = 968;

/** Items of the selected filter and the site key of each item. */
function gridItems(
  groups: readonly SiteGroup[],
  filter: string,
): { items: Vod[]; siteOf: Map<Vod, SiteGroup['site']> } {
  const siteOf = new Map<Vod, SiteGroup['site']>();
  const items: Vod[] = [];
  for (const { site, list } of groups) {
    if (filter !== ALL && site.key !== filter) continue;
    for (const vod of list) {
      siteOf.set(vod, site);
      items.push(vod);
    }
  }
  return { items, siteOf };
}

const joinMeta = (parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;

export interface ResultsProps {
  keyword: string;
  progress: SearchProgress;
}

/** Results of one search: header, per-site filters and a four-column poster grid. */
export function Results({ keyword, progress }: ResultsProps) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const [filter, setFilter] = useState(ALL);
  const { groups, done } = progress;
  const selected = groups.some((group) => group.site.key === filter) ? filter : ALL;
  const { items, siteOf } = useMemo(() => gridItems(groups, selected), [groups, selected]);
  const count = groups.reduce((sum, group) => sum + group.list.length, 0);
  const filters = [
    { key: ALL, title: `全部 (${count})` },
    ...groups.map((group) => ({
      key: group.site.key,
      title: `${group.site.name || group.site.key} (${group.list.length})`,
    })),
  ];
  // The aggregated view names the site; a single site shows the year and remarks.
  const metaOf = useCallback(
    (vod: Vod) => {
      if (selected !== ALL) return joinMeta([vod.vod_year, vod.vod_remarks]);
      const site = siteOf.get(vod);
      return joinMeta([site && (site.name || site.key), vod.vod_year]);
    },
    [selected, siteOf],
  );

  return (
    <View testID="search-results" style={styles.container}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.title}>{`“${keyword}” 的搜索结果`}</Text>
        <Text style={styles.caption}>{done ? `${count} 个结果` : `${count} 个结果 · 搜索中…`}</Text>
      </View>
      {groups.length > 0 ? (
        <ScrollView
          testID="search-filters"
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filters}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map((item) => (
            <Chip
              key={item.key || 'all'}
              testID={`search-filter-${item.key || 'all'}`}
              label={item.title}
              selected={item.key === selected}
              onPress={() => setFilter(item.key)}
            />
          ))}
        </ScrollView>
      ) : null}
      {/* The grid adds the screen safe area on both sides; the pane already sits inside it. */}
      <View style={styles.grid}>
        <VodGrid
          items={items}
          loading={!done}
          columns={COLUMNS}
          width={RESULTS_WIDTH + safeArea.horizontal * 2}
          metaOf={metaOf}
          ListEmptyComponent={<Text style={styles.empty}>没有找到相关结果</Text>}
          onPressVod={(vod) => openVod(navigation, siteOf.get(vod)?.key ?? selected, vod)}
        />
      </View>
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    container: { flex: 1 },
    header: { gap: s(space.xs) },
    title: { ...text.h1, color: color.text },
    caption: { ...text.caption, fontSize: s(22), lineHeight: s(30), color: color.text3 },
    filters: { flexGrow: 0, marginTop: s(space.md), overflow: 'visible' as const },
    filterRow: { gap: s(12) },
    grid: { flex: 1, marginTop: s(space.xs), marginHorizontal: -s(safeArea.horizontal) },
    empty: { ...text.body, marginVertical: s(space.xl), color: color.text2 },
  };
};
