import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, UnsupportedSiteError } from '../../core/provider';
import type { Site, Vod } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import { colors, FocusableButton, fontSize, HorizontalRow, spacing } from '../../ui';
import { LoadingView, openVod, VodGrid } from '../common';
import { searchSites, searchTargets, type SearchProgress, type SiteGroup } from './searchSites';

/** Filter key of the aggregated view. */
const ALL = '';

interface FilterItem {
  key: string;
  title: string;
}

function searchSite(site: Site, keyword: string, quick: boolean) {
  try {
    return getProvider(site).search(keyword, quick);
  } catch (error) {
    if (error instanceof UnsupportedSiteError) return Promise.reject(new Error('站点不支持搜索'));
    throw error;
  }
}

// "All" shows each result with its site name as the remark. The copies are kept per result so a
// grid update reuses them and the memoized cards of earlier sites do not re-render.
const labelled = new WeakMap<Vod, Vod>();

function withSiteRemark(vod: Vod, name: string): Vod {
  let item = labelled.get(vod);
  if (!item) {
    item = { ...vod, vod_remarks: name };
    labelled.set(vod, item);
  }
  return item;
}

/** Items of the selected filter; the aggregated view shows the site name as subtitle. */
function gridItems(groups: readonly SiteGroup[], filter: string): { items: Vod[]; siteKeys: Map<Vod, string> } {
  const siteKeys = new Map<Vod, string>();
  const items: Vod[] = [];
  for (const { site, list } of groups) {
    if (filter !== ALL && site.key !== filter) continue;
    for (const vod of list) {
      const item = filter === ALL ? withSiteRemark(vod, site.name || site.key) : vod;
      siteKeys.set(item, site.key);
      items.push(item);
    }
  }
  return { items, siteKeys };
}

function Results({ progress }: { progress: SearchProgress }) {
  const navigation = useAppNavigation();
  const [filter, setFilter] = useState(ALL);
  const { groups, completed, total, done } = progress;
  const selected = groups.some((group) => group.site.key === filter) ? filter : ALL;
  const { items, siteKeys } = useMemo(() => gridItems(groups, selected), [groups, selected]);
  const filters: FilterItem[] = [
    { key: ALL, title: `全部 (${groups.reduce((sum, group) => sum + group.list.length, 0)})` },
    ...groups.map((group) => ({
      key: group.site.key,
      title: `${group.site.name || group.site.key} (${group.list.length})`,
    })),
  ];

  return (
    <View style={styles.results}>
      {done ? null : <Text style={styles.note}>{`正在搜索 ${completed}/${total} 个站点`}</Text>}
      {groups.length > 0 ? (
        <HorizontalRow
          testID="search-filters"
          data={filters}
          keyExtractor={(item) => item.key || 'all'}
          renderItem={({ item }) => (
            <FocusableButton
              testID={`search-filter-${item.key || 'all'}`}
              title={item.title}
              selected={item.key === selected}
              onPress={() => setFilter(item.key)}
            />
          )}
        />
      ) : null}
      {done && groups.length === 0 ? (
        <Text style={styles.empty}>未找到结果</Text>
      ) : (
        <VodGrid
          items={items}
          loading={!done}
          preferFirstFocus
          onPressVod={(vod) => openVod(navigation, siteKeys.get(vod) ?? selected, vod)}
        />
      )}
    </View>
  );
}

/** CollectActivity: searches every searchable site for the keyword and groups the answers by site. */
export default function SearchResultScreen({ route }: RootStackScreenProps<'SearchResult'>) {
  const { keyword, quick = false } = route.params;
  const { status, config } = useVodConfig();
  const sites = config?.sites;
  const [progress, setProgress] = useState<SearchProgress>();

  // Leaving the screen or a new config cancels the running search; its late answers are dropped.
  useEffect(() => {
    if (!sites) return;
    const handle = searchSites(searchTargets(sites, quick), (site) => searchSite(site, keyword, quick), setProgress);
    return handle.cancel;
  }, [keyword, quick, sites]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>搜索结果</Text>
        <Text style={styles.keyword} numberOfLines={1}>
          {keyword}
        </Text>
      </View>
      {!sites ? (
        status === 'loading' ? (
          <LoadingView />
        ) : (
          <Text style={styles.empty}>尚未加载配置</Text>
        )
      ) : progress ? (
        <Results progress={progress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.heading },
  keyword: { flexShrink: 1, marginLeft: spacing.md, color: colors.primary, fontSize: fontSize.heading },
  results: { flex: 1 },
  note: {
    marginHorizontal: spacing.xl,
    marginVertical: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  empty: { marginVertical: spacing.xl, color: colors.textSecondary, fontSize: fontSize.body, textAlign: 'center' },
});
