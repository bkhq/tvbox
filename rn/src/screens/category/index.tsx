import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, type SiteProvider, UnsupportedSiteError } from '../../core/provider';
import type { Filter } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import { colors, FocusableButton, fontSize, HorizontalRow, spacing } from '../../ui';
import { ErrorView, LoadingView, openVod, usePagedList, useSite, VodGrid } from '../common';
import { type FilterSelection, initialSelection, selectFilter, toExtend } from './filterState';

/** Route label plus class name; TV screens have no navigation header. */
function Header({ typeName, children }: { typeName: string; children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.label}>分类</Text>
      <Text style={styles.title} numberOfLines={1}>
        {typeName}
      </Text>
      {children}
    </View>
  );
}

function FilterPanel({
  filters,
  selection,
  onSelect,
}: {
  filters: readonly Filter[];
  selection: FilterSelection;
  onSelect: (key: string, value: string) => void;
}) {
  return (
    <ScrollView style={styles.panel} testID="category-filter-panel">
      {filters.map((filter, row) => (
        <HorizontalRow
          key={filter.key}
          title={filter.name}
          data={filter.value}
          keyExtractor={(value, index) => `${index}-${value.v}`}
          renderItem={({ item, index }) => {
            const selected = selection[filter.key] === item.v;
            return (
              <FocusableButton
                testID={`category-filter-${filter.key}-${index}`}
                title={item.n}
                selected={selected}
                hasTVPreferredFocus={row === 0 && selected}
                onPress={() => onSelect(filter.key, item.v)}
              />
            );
          }}
        />
      ))}
    </ScrollView>
  );
}

function CategoryList({
  provider,
  siteKey,
  typeId,
  typeName,
  filters,
}: {
  provider: SiteProvider;
  siteKey: string;
  typeId: string;
  typeName: string;
  filters: readonly Filter[];
}) {
  const navigation = useAppNavigation();
  const [selection, setSelection] = useState(() => initialSelection(filters));
  const [panelOpen, setPanelOpen] = useState(false);
  const extend = useMemo(() => toExtend(selection), [selection]);
  const list = usePagedList(
    (page) => provider.category(typeId, String(page), true, extend),
    [provider, typeId, JSON.stringify(extend)],
  );

  // Back closes the filter panel before leaving the screen.
  useEffect(() => {
    if (!panelOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPanelOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [panelOpen]);

  const hasFilters = filters.length > 0;
  const empty = list.items.length === 0;
  const failed = empty && list.error !== undefined;

  return (
    <View style={styles.container}>
      <Header typeName={typeName}>
        {hasFilters ? (
          <FocusableButton
            testID="category-filter-toggle"
            title="筛选"
            selected={panelOpen}
            hasTVPreferredFocus={!panelOpen && empty}
            onPress={() => setPanelOpen((open) => !open)}
          />
        ) : null}
      </Header>
      {panelOpen ? (
        <FilterPanel
          filters={filters}
          selection={selection}
          onSelect={(key, value) => setSelection((current) => selectFilter(current, key, value))}
        />
      ) : null}
      {failed ? (
        <ErrorView
          testID="category-error"
          message={`加载失败：${list.error?.message ?? ''}`}
          onRetry={list.reload}
          hasTVPreferredFocus={!hasFilters}
        />
      ) : (
        <VodGrid
          items={list.items}
          loading={list.loading}
          onEndReached={list.loadMore}
          onPressVod={(vod) => openVod(navigation, siteKey, vod)}
          preferFirstFocus={!panelOpen}
        />
      )}
    </View>
  );
}

function CategoryContent({
  provider,
  siteKey,
  typeId,
  typeName,
}: {
  provider: SiteProvider;
  siteKey: string;
  typeId: string;
  typeName: string;
}) {
  const [filters, setFilters] = useState<Filter[]>();

  // The class filters come with homeContent; without them the screen simply has no filter panel.
  useEffect(() => {
    let active = true;
    provider.home(true).then(
      (result) => active && setFilters(result.filters[typeId] ?? []),
      () => active && setFilters([]),
    );
    return () => {
      active = false;
    };
  }, [provider, typeId]);

  if (!filters) {
    return (
      <View style={styles.container}>
        <Header typeName={typeName} />
        <LoadingView />
      </View>
    );
  }
  return <CategoryList provider={provider} siteKey={siteKey} typeId={typeId} typeName={typeName} filters={filters} />;
}

export default function CategoryScreen({ route }: RootStackScreenProps<'Category'>) {
  const { siteKey, typeId, typeName } = route.params;
  const { status } = useVodConfig();
  const site = useSite(siteKey);
  const provider = useMemo(() => {
    if (!site) return undefined;
    try {
      return getProvider(site);
    } catch (error) {
      if (error instanceof UnsupportedSiteError) return undefined;
      throw error;
    }
  }, [site]);

  if (provider) return <CategoryContent provider={provider} siteKey={siteKey} typeId={typeId} typeName={typeName} />;
  return (
    <View style={styles.container}>
      <Header typeName={typeName} />
      {status === 'loading' ? <LoadingView /> : <ErrorView testID="category-unavailable" message="站点不可用" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  label: {
    marginRight: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  panel: {
    flexGrow: 0,
    maxHeight: '50%',
  },
});
