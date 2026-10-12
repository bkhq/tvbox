import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, UnsupportedSiteError } from '../../core/provider';
import type { Site, Vod } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import { colors, FocusableButton, fontSize, HorizontalRow, radius, spacing } from '../../ui';
import { FocusableInput, LoadingView, openVod, VodGrid } from '../common';
import { addHistory, getHistory } from './history';
import { searchSites, searchTargets, type SearchProgress, type SiteGroup } from './searchSites';

/** Filter key of the aggregated view. */
const ALL = '';

interface Query {
  keyword: string;
  /** Bumped on every submit so the same keyword searches again. */
  id: number;
}

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

/** Items of the selected filter; the aggregated view shows the site name as subtitle. */
function gridItems(groups: readonly SiteGroup[], filter: string): { items: Vod[]; siteKeys: Map<Vod, string> } {
  const siteKeys = new Map<Vod, string>();
  const items: Vod[] = [];
  for (const { site, list } of groups) {
    if (filter !== ALL && site.key !== filter) continue;
    for (const vod of list) {
      const item = filter === ALL ? { ...vod, vod_remarks: site.name || site.key } : vod;
      siteKeys.set(item, site.key);
      items.push(item);
    }
  }
  return { items, siteKeys };
}

function Results({
  progress,
  filter,
  onFilter,
  preferFocus,
}: {
  progress: SearchProgress;
  filter: string;
  onFilter: (key: string) => void;
  preferFocus: boolean;
}) {
  const navigation = useAppNavigation();
  const { groups, completed, total, done } = progress;
  const selected = groups.some((group) => group.site.key === filter) ? filter : ALL;
  const { items, siteKeys } = useMemo(() => gridItems(groups, selected), [groups, selected]);
  const filters: FilterItem[] = [
    { key: ALL, title: `全部 (${groups.reduce((sum, group) => sum + group.list.length, 0)})` },
    ...groups.map((group) => ({ key: group.site.key, title: `${group.site.name || group.site.key} (${group.list.length})` })),
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
              onPress={() => onFilter(item.key)}
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
          preferFirstFocus={preferFocus}
          onPressVod={(vod) => openVod(navigation, siteKeys.get(vod) ?? selected, vod)}
        />
      )}
    </View>
  );
}

export default function SearchScreen({ route }: RootStackScreenProps<'Search'>) {
  const routeKeyword = route.params?.keyword?.trim() ?? '';
  const { status, config } = useVodConfig();
  const sites = config?.sites;
  const [input, setInput] = useState(routeKeyword);
  const [quick, setQuick] = useState(false);
  const [query, setQuery] = useState<Query | undefined>(routeKeyword ? { keyword: routeKeyword, id: 0 } : undefined);
  const [history, setHistory] = useState(() => (routeKeyword ? addHistory(routeKeyword) : getHistory()));
  const [progress, setProgress] = useState<SearchProgress>();
  const [filter, setFilter] = useState(ALL);
  // A history keyword unmounts the pressed button, so its results take the focus.
  const [fromHistory, setFromHistory] = useState(false);

  // A new query, mode or config cancels the running search; its late answers are dropped.
  useEffect(() => {
    if (!query || !sites) return;
    const handle = searchSites(
      searchTargets(sites, quick),
      (site) => searchSite(site, query.keyword, quick),
      setProgress,
    );
    return handle.cancel;
  }, [query, quick, sites]);

  const search = (text: string, history = false) => {
    const keyword = text.trim();
    if (!keyword) return;
    setFromHistory(history);
    setInput(keyword);
    setFilter(ALL);
    setHistory(addHistory(keyword));
    setQuery((current) => ({ keyword, id: (current?.id ?? 0) + 1 }));
  };

  const focusResults = routeKeyword !== '' || fromHistory;
  const nothingFound = progress?.done === true && progress.groups.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>搜索</Text>
      </View>
      <View style={styles.form}>
        <FocusableInput
          testID="search-input"
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => search(input)}
          placeholder="输入关键词"
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          hasTVPreferredFocus={!focusResults || nothingFound}
        />
        <FocusableButton testID="search-submit" title="搜索" disabled={!input.trim()} onPress={() => search(input)} />
        <FocusableButton
          testID="search-quick"
          title="快速搜索"
          selected={quick}
          onPress={() => {
            setFilter(ALL);
            setQuick((value) => !value);
          }}
        />
      </View>
      {input.trim() === '' && history.length > 0 ? (
        <View style={styles.history} testID="search-history">
          {history.map((keyword) => (
            <FocusableButton
              key={keyword}
              testID={`search-history-${keyword}`}
              title={keyword}
              onPress={() => search(keyword, true)}
            />
          ))}
        </View>
      ) : null}
      {query && !sites ? (
        status === 'loading' ? (
          <LoadingView />
        ) : (
          <Text style={styles.empty}>尚未加载配置</Text>
        )
      ) : null}
      {query && sites && progress ? (
        <Results progress={progress} filter={filter} onFilter={setFilter} preferFocus={focusResults} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.heading,
  },
  form: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginVertical: spacing.sm,
  },
  input: {
    flex: 1,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
  },
  history: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
  },
  results: {
    flex: 1,
  },
  note: {
    marginHorizontal: spacing.xl,
    marginVertical: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  empty: {
    marginVertical: spacing.xl,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    textAlign: 'center',
  },
});
