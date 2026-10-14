import { Text, View } from 'react-native';

import { getProvider } from '../../core/provider';
import type { Class, Site, Vod } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { Button, color, safeArea, scaledText, space, useScaledStyles, type Scaler } from '../../ui';
import { ErrorView, openVod, usePagedList, VodGrid } from '../common';

/** 剧集 / 电影: the class backing the section as a paged poster grid, the filters one press away. */
export function SectionView({ site, cls, preferFocus }: { site: Site; cls: Class; preferFocus: boolean }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const list = usePagedList<Vod>(
    (page) => getProvider(site).category(cls.type_id, String(page), false, {}),
    [site, cls.type_id],
  );
  const category = () =>
    navigation.navigate('Category', { siteKey: site.key, typeId: cls.type_id, typeName: cls.type_name });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text testID="home-section-title" numberOfLines={1} style={styles.title}>
          {cls.type_name}
        </Text>
        {cls.filters.length > 0 ? (
          <Button testID="home-section-filter" title="筛选" size="md" onPress={category} />
        ) : null}
      </View>
      {list.error && list.items.length === 0 ? (
        <ErrorView
          testID="home-section-error"
          message={`加载失败：${list.error.message}`}
          onRetry={list.reload}
          hasTVPreferredFocus={preferFocus}
        />
      ) : (
        <VodGrid
          testID="home-section-grid"
          items={list.items}
          loading={list.loading}
          onEndReached={list.loadMore}
          onPressVod={(vod) => openVod(navigation, site.key, vod)}
          preferFirstFocus={preferFocus}
        />
      )}
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  container: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: s(space.md),
    paddingHorizontal: s(safeArea.horizontal),
    paddingBottom: s(space.xs),
  },
  title: { ...scaledText(s).h1, color: color.text },
});
