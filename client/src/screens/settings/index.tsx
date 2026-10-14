import { type ComponentType, useState } from 'react';
import { ScrollView, TVFocusGuideView, View } from 'react-native';

import { useMainNav } from '../../navigation/mainNav';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { color, safeArea, TopNav, useScaledStyles, type Scaler } from '../../ui';
import { CollectView } from '../collect';
import { HistoryView } from '../history';
import { ProfileMenu } from './ProfileMenu';
import {
  AboutSection,
  LiveSection,
  NetworkSection,
  PlaybackSection,
  type SettingsSectionId,
  SourcesSection,
  SubtitleAudioSection,
} from './sections';

const SECTIONS: Record<Exclude<SettingsSectionId, 'collect' | 'history'>, ComponentType> = {
  play: PlaybackSection,
  subaudio: SubtitleAudioSection,
  live: LiveSection,
  net: NetworkSection,
  sources: SourcesSection,
  about: AboutSection,
};

function SectionPanel({ id }: { id: SettingsSectionId }) {
  const styles = useScaledStyles(makeStyles);
  // The record views scroll their own grid; the settings sections need a scroll view.
  if (id === 'collect' || id === 'history') {
    const Records = id === 'collect' ? CollectView : HistoryView;
    return (
      <View style={styles.panel}>
        <Records embedded hasTVPreferredFocus={false} />
      </View>
    );
  }
  const Section = SECTIONS[id];
  return (
    <ScrollView testID="settings-panel-scroll" style={styles.panel} contentContainerStyle={styles.panelContent}>
      <Section />
    </ScrollView>
  );
}

/** The 我的 tab: section menu on the left, the selected section on the right. */
export default function SettingsScreen() {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const nav = useMainNav('profile');
  const [selected, setSelected] = useState<SettingsSectionId>('play');

  return (
    <View style={styles.screen}>
      <TopNav
        testID="settings-top-nav"
        items={nav.items}
        onSelect={nav.select}
        onSearch={() => navigation.navigate('Search')}
      />
      <View style={styles.content}>
        <ProfileMenu selected={selected} onSelect={setSelected} hasTVPreferredFocus />
        {/* Entering from the menu lands on the panel's first (or last focused) element. */}
        <TVFocusGuideView autoFocus style={styles.panelGuide}>
          <SectionPanel key={selected} id={selected} />
        </TVFocusGuideView>
      </View>
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    flex: 1,
    flexDirection: 'row' as const,
    gap: s(64),
    paddingHorizontal: s(safeArea.horizontal),
    paddingBottom: s(safeArea.vertical),
  },
  panelGuide: { flex: 1 },
  panel: { flex: 1, paddingRight: s(16) },
  panelContent: { paddingBottom: s(40) },
});
