import { FlatList, Modal, Pressable, Text, View } from 'react-native';

import { useSetting } from '../../core/settings';
import type { Site, SiteUnsupportedReason } from '../../core/types';
import {
  Badge,
  Button,
  color,
  focus,
  FocusRing,
  radii,
  scaledText,
  space,
  useScale,
  useScaledStyles,
  useFocusAnimation,
  type Scaler,
} from '../../ui';

const REASON_TEXT: Record<SiteUnsupportedReason, string> = { jar: 'JAR 爬虫', py: 'Python 爬虫', type: '未知类型' };

export function unsupportedText(site: Site): string {
  return `不支持：${site.unsupportedReason ? REASON_TEXT[site.unsupportedReason] : '未知原因'}`;
}

function SiteRow({ site, isHome, onSelect }: { site: Site; isHome: boolean; onSelect: (site: Site) => void }) {
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const { focused, handlers } = useFocusAnimation();
  return (
    <Pressable
      testID={`home-site-${site.key}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !site.supported, selected: isHome }}
      disabled={!site.supported}
      hasTVPreferredFocus={isHome && site.supported}
      onPress={() => onSelect(site)}
      {...handlers}
      style={[styles.site, focused && styles.siteFocused, !site.supported && styles.siteUnsupported]}
    >
      {focused ? <FocusRing radius={s(radii.button)} /> : null}
      <Text style={[styles.siteName, focused && styles.siteNameFocused]} numberOfLines={1}>
        {site.name || site.key}
      </Text>
      {isHome ? <Badge testID="home-site-badge" label="首页" variant="accent" /> : null}
      {site.supported ? null : <Text style={styles.unsupported}>{unsupportedText(site)}</Text>}
    </Pressable>
  );
}

/**
 * SiteDialog: every site of the config, unsupported ones disabled. The hardware back key (Android) and the
 * Menu button (tvOS) call onRequestClose, so back closes the picker before the screen is popped.
 */
/** Seven rows; keeps the title and the close button inside the 1080 px screen. */
export const SITE_LIST_MAX_HEIGHT = 640;

export function SitePicker({ sites, homeKey, onClose }: { sites: Site[]; homeKey?: string; onClose: () => void }) {
  const [, setHomeSiteKey] = useSetting('homeSiteKey');
  const styles = useScaledStyles(makeStyles);
  const select = (site: Site) => {
    onClose();
    void setHomeSiteKey(site.key);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="home-site-picker" style={styles.panel}>
          <Text style={styles.title}>切换站点</Text>
          <FlatList
            testID="home-site-list"
            style={styles.sites}
            data={sites}
            keyExtractor={(site) => site.key}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <SiteRow site={item} isHome={item.key === homeKey} onSelect={select} />}
          />
          <Button testID="home-site-picker-close" title="关闭" size="md" style={styles.close} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    backdrop: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(11,14,20,0.7)',
    },
    panel: {
      width: s(880),
      maxHeight: '86%' as const,
      padding: s(48),
      gap: s(space.md),
      borderRadius: s(radii.card),
      backgroundColor: color.surface,
    },
    title: { ...text.h1, color: color.text },
    // An explicit cap: the panel's maxHeight alone lets a long list push the close button off screen.
    sites: { maxHeight: s(SITE_LIST_MAX_HEIGHT) },
    // Room for the focus ring of the first and last row.
    list: { gap: s(space.sm), paddingVertical: s(focus.bleed), paddingHorizontal: s(focus.bleed) },
    site: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(space.sm),
      height: s(76),
      paddingHorizontal: s(32),
      borderRadius: s(radii.button),
      backgroundColor: color.surface2,
    },
    siteFocused: { backgroundColor: focus.borderColor },
    siteUnsupported: { opacity: 0.5 },
    siteName: { ...text.body, flex: 1, color: color.text },
    siteNameFocused: { color: color.inverseText },
    unsupported: { ...text.caption, color: color.text3 },
    close: { alignSelf: 'flex-end' as const },
  };
};
