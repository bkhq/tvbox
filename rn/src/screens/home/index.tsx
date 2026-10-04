import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { selectHome, supportedSites } from '../../core/config';
import { useVodConfig } from '../../core/bootstrap';
import { useSetting } from '../../core/settings';
import type { Site, SiteUnsupportedReason } from '../../core/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import type { RouteName } from '../../navigation/types';
import { colors, FocusableButton, fontSize, radius, spacing } from '../../ui';

const NAV_LINKS: { route: Extract<RouteName, 'Settings' | 'History' | 'Collect' | 'Search'>; title: string }[] = [
  { route: 'Search', title: '搜索' },
  { route: 'History', title: '历史记录' },
  { route: 'Collect', title: '收藏' },
  { route: 'Settings', title: '设置' },
];

const REASON_TEXT: Record<SiteUnsupportedReason, string> = {
  jar: 'JAR 爬虫',
  py: 'Python 爬虫',
  type: '未知类型',
};

export function unsupportedText(site: Site): string {
  return `不支持：${site.unsupportedReason ? REASON_TEXT[site.unsupportedReason] : '未知原因'}`;
}

function NavBar({ preferFocus }: { preferFocus: boolean }) {
  const navigation = useAppNavigation();
  return (
    <View style={styles.nav}>
      {NAV_LINKS.map((link, index) => (
        <FocusableButton
          key={link.route}
          testID={`home-nav-${link.route}`}
          title={link.title}
          hasTVPreferredFocus={preferFocus && index === 0}
          onPress={() => navigation.navigate(link.route)}
        />
      ))}
    </View>
  );
}

function AddConfigForm({ preferFocus }: { preferFocus: boolean }) {
  const { addConfig } = useVodConfig();
  const [url, setUrl] = useState('');
  const submit = () => {
    if (url.trim()) void addConfig(url);
  };
  return (
    <View style={styles.form}>
      <TextInput
        testID="home-config-input"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        onSubmitEditing={submit}
        placeholder="输入配置地址"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hasTVPreferredFocus={preferFocus}
      />
      <FocusableButton testID="home-config-add" title="添加配置" disabled={!url.trim()} onPress={submit} />
    </View>
  );
}

function SiteRow({ site, isHome, preferFocus }: { site: Site; isHome: boolean; preferFocus: boolean }) {
  const [, setHomeSiteKey] = useSetting('homeSiteKey');
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={`home-site-${site.key}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !site.supported, selected: isHome }}
      disabled={!site.supported}
      hasTVPreferredFocus={preferFocus}
      onPress={() => void setHomeSiteKey(site.key)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.site, focused && styles.siteFocused, !site.supported && styles.siteUnsupported]}
    >
      <Text style={styles.siteName} numberOfLines={1}>
        {site.name || site.key}
      </Text>
      {isHome ? <Text style={styles.homeBadge}>首页</Text> : null}
      {site.supported ? null : <Text style={styles.unsupported}>{unsupportedText(site)}</Text>}
    </Pressable>
  );
}

function SiteList() {
  const { config, entry } = useVodConfig();
  const [homeSiteKey] = useSetting('homeSiteKey');
  if (!config) return null;
  const home = selectHome(config.sites, homeSiteKey || config.home?.key);
  const count = supportedSites(config).length;
  return (
    <FlatList
      testID="home-sites"
      data={config.sites}
      keyExtractor={(site) => site.key}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
          <Text style={styles.title} numberOfLines={1}>
            {entry?.name || config.url}
          </Text>
          <Text style={styles.note}>{`共 ${config.sites.length} 个站点，可用 ${count} 个`}</Text>
          <NavBar preferFocus={count === 0} />
        </View>
      }
      renderItem={({ item }) => (
        <SiteRow site={item} isHome={item.key === home?.key} preferFocus={item.key === home?.key} />
      )}
    />
  );
}

export default function HomeScreen() {
  const { status, error, reload } = useVodConfig();

  if (status === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>首页</Text>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.note}>正在加载配置…</Text>
      </View>
    );
  }

  if (status === 'ready') {
    return (
      <View style={styles.container}>
        <SiteList />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.padded]}>
      <Text style={styles.title}>首页</Text>
      {status === 'error' ? (
        <View>
          <Text style={styles.error}>{`配置加载失败：${error?.message ?? ''}`}</Text>
          <FocusableButton testID="home-reload" title="重试" hasTVPreferredFocus onPress={() => void reload()} />
        </View>
      ) : (
        <Text style={styles.note}>尚未添加配置</Text>
      )}
      <AddConfigForm preferFocus={status === 'empty'} />
      <NavBar preferFocus={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  padded: {
    padding: spacing.xl,
  },
  list: {
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.display,
  },
  note: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  error: {
    marginVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body,
  },
  nav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: spacing.md,
  },
  form: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
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
  site: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  siteFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.surfaceFocused,
  },
  siteUnsupported: {
    opacity: 0.5,
  },
  siteName: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.title,
  },
  homeBadge: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    color: colors.text,
    fontSize: fontSize.caption,
  },
  unsupported: {
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
});
