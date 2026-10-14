import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { getProvider, type SiteProvider, UnsupportedSiteError } from '../../core/provider';
import type { Filter } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RootStackScreenProps } from '../../navigation/types';
import {
  BackButton,
  Button,
  Chip,
  Clock,
  color,
  focus,
  safeArea,
  scaledText,
  space,
  useScaledStyles,
  type Scaler,
} from '../../ui';
import { ErrorView, LoadingView, openVod, usePagedList, useSite, VodGrid } from '../common';
import { type FilterSelection, initialSelection, selectFilter, toExtend } from './filterState';

/** Back pill, route label plus class name, and clock; TV screens have no navigation header. */
function Header({ typeName, children }: { typeName: string; children?: ReactNode }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.header}>
      <BackButton testID="category-back" onPress={() => navigation.goBack()} />
      <Text style={styles.label}>分类</Text>
      <Text style={styles.title} numberOfLines={1}>
        {typeName}
      </Text>
      {children}
      <Clock />
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
  const styles = useScaledStyles(makeStyles);
  return (
    <ScrollView style={styles.panel} testID="category-filter-panel">
      {filters.map((filter, row) => (
        <View key={filter.key} style={styles.filterRow}>
          <Text style={styles.filterLabel} numberOfLines={1}>
            {filter.name}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {filter.value.map((item, index) => {
              const selected = selection[filter.key] === item.v;
              return (
                <Chip
                  key={`${index}-${item.v}`}
                  testID={`category-filter-${filter.key}-${index}`}
                  label={item.n}
                  selected={selected}
                  hasTVPreferredFocus={row === 0 && selected}
                  onPress={() => onSelect(filter.key, item.v)}
                />
              );
            })}
          </ScrollView>
        </View>
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
  const styles = useScaledStyles(makeStyles);
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
          <Button
            testID="category-filter-toggle"
            title="筛选"
            size="md"
            variant={panelOpen ? 'primary' : 'secondary'}
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
  const styles = useScaledStyles(makeStyles);
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
  const styles = useScaledStyles(makeStyles);
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

const makeStyles = (s: Scaler) => {
  const { h1, label } = scaledText(s);
  return {
    container: { flex: 1, backgroundColor: color.bg },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(space.md),
      paddingHorizontal: s(safeArea.horizontal),
      paddingTop: s(safeArea.vertical),
      paddingBottom: s(space.sm),
    },
    label: { ...label, marginLeft: s(space.xs), color: color.text3 },
    title: { ...h1, flex: 1, marginLeft: -s(space.xs), color: color.text },
    panel: { flexGrow: 0, maxHeight: '50%' as const },
    filterRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: s(safeArea.horizontal) },
    filterLabel: { ...label, width: s(120), color: color.text3 },
    // Chips bleed to the right screen edge; the vertical bleed keeps the focus zoom and ring unclipped.
    chips: {
      gap: s(space.sm),
      paddingVertical: s(focus.bleed),
      paddingLeft: s(focus.bleed),
      paddingRight: s(safeArea.horizontal),
    },
  };
};
