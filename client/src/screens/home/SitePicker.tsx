import { FlatList, Modal, Text, View } from 'react-native';

import { useSetting } from '../../core/settings';
import type { Site, SiteUnsupportedReason } from '../../core/types';
import { Button, color, focus, OptionRow, radii, scaledText, space, useScaledStyles, type Scaler } from '../../ui';

const REASON_TEXT: Record<SiteUnsupportedReason, string> = { jar: 'JAR 爬虫', py: 'Python 爬虫', type: '未知类型' };

export function unsupportedText(site: Site): string {
  return `不支持：${site.unsupportedReason ? REASON_TEXT[site.unsupportedReason] : '未知原因'}`;
}

function SiteRow({ site, isHome, onSelect }: { site: Site; isHome: boolean; onSelect: (site: Site) => void }) {
  return (
    <OptionRow
      testID={`home-site-${site.key}`}
      label={site.name || site.key}
      hint={site.supported ? undefined : unsupportedText(site)}
      selected={isHome}
      raised
      disabled={!site.supported}
      hasTVPreferredFocus={isHome && site.supported}
      onPress={() => onSelect(site)}
    />
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
    close: { alignSelf: 'flex-end' as const },
  };
};
