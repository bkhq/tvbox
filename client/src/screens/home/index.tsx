import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { selectHome } from '../../core/config';
import { useVodConfig } from '../../core/bootstrap';
import { useSetting } from '../../core/settings';
import { type Class, type History, normalizeVod, type Site } from '../../core/types';
import { useMainNav } from '../../navigation/mainNav';
import type { RootStackScreenProps } from '../../navigation/types';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import {
  Button,
  Chip,
  color,
  PosterCard,
  Row,
  safeArea,
  scaledText,
  space,
  TopNav,
  useScaledStyles,
  WideCard,
  type Scaler,
} from '../../ui';
import { displayRemarks, ErrorView, LoadingView, openVod, useActiveCid } from '../common';
import { ConfigSetup } from './ConfigSetup';
import { progressOf, siteKeyOf, subtitleOf, useContinueWatching, vodIdOf } from './continueWatching';
import { Hero, type HeroItem } from './Hero';
import { createSiteHomeContent, type HomeContent, type HomeRow, useHomeContent } from './homeContent';
import { type HomeSection, remainingClasses, resolveSections, useSectionAvailability } from './sections';
import { SectionView } from './SectionView';
import { SitePicker } from './SitePicker';

export { unsupportedText } from './SitePicker';

/** Delay before a focused card becomes the hero, so scrolling through a row does not repaint it per card. */
export const HERO_FOCUS_DELAY = 250;

function HeaderActions({ onSwitch }: { onSwitch?: () => void }) {
  const navigation = useAppNavigation();
  return (
    <>
      <Button
        testID="home-control"
        variant="outline"
        icon="phone"
        accessibilityLabel="手机控制"
        onPress={() => navigation.navigate('Control')}
      />
      <Button
        testID="home-settings"
        variant="outline"
        icon="settings"
        accessibilityLabel="设置"
        onPress={() => navigation.navigate('Settings')}
      />
      {onSwitch ? (
        <Button
          testID="home-switch-site"
          variant="outline"
          icon="switch"
          accessibilityLabel="切换站点"
          onPress={onSwitch}
        />
      ) : null}
    </>
  );
}

function Header({ section, overlay, onSwitch }: { section?: HomeSection; overlay?: boolean; onSwitch?: () => void }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const { items, select } = useMainNav(section ?? 'home');
  return (
    <TopNav
      testID="home-top-nav"
      items={items}
      onSelect={select}
      onSearch={() => navigation.navigate('Search')}
      right={<HeaderActions onSwitch={onSwitch} />}
      style={overlay ? styles.overlay : undefined}
    />
  );
}

interface HomeRowsProps {
  history: History[];
  rows: HomeRow[];
  classes: Class[];
  siteKey: string;
  onFocusItem: (item: HeroItem) => void;
}

// Memoized: the hero repaints on focus changes, the rows only when their data does.
const HomeRows = memo(function HomeRows({ history, rows, classes, siteKey, onFocusItem }: HomeRowsProps) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.rows}>
      {history.length > 0 ? (
        <Row
          testID="home-continue"
          title="继续观看"
          caption="保存在本机"
          data={history}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            const vodId = vodIdOf(item);
            const itemSiteKey = siteKeyOf(item);
            return (
              <WideCard
                testID={`home-continue-${item.key}`}
                title={item.vodName}
                subtitle={subtitleOf(item) || undefined}
                image={item.vodPic}
                progress={progressOf(item)}
                onFocus={() =>
                  onFocusItem({
                    siteKey: itemSiteKey,
                    vod: normalizeVod({
                      vod_id: vodId,
                      vod_name: item.vodName,
                      vod_pic: item.vodPic,
                      vod_remarks: item.vodRemarks,
                    }),
                  })
                }
                onPress={() =>
                  navigation.navigate('Detail', {
                    siteKey: itemSiteKey,
                    vodId,
                    vodName: item.vodName,
                    vodPic: item.vodPic,
                  })
                }
              />
            );
          }}
        />
      ) : null}
      {rows.map((row) => (
        <Row
          key={row.key}
          testID={`home-row-${row.key}`}
          title={row.title}
          data={row.items}
          keyExtractor={(vod, index) => `${vod.vod_id}-${index}`}
          renderItem={({ item }) => (
            <PosterCard
              testID={`home-card-${row.key}-${item.vod_id}`}
              title={item.vod_name}
              poster={item.vod_pic}
              meta={item.vod_year || displayRemarks(item.vod_remarks)}
              badge={item.vod_year ? displayRemarks(item.vod_remarks) : undefined}
              onFocus={() => onFocusItem({ siteKey: row.siteKey, vod: item })}
              onPress={() => openVod(navigation, row.siteKey, item)}
            />
          )}
        />
      ))}
      {classes.length > 0 ? (
        <Row
          testID="home-classes"
          title="分类"
          data={classes}
          keyExtractor={(item, index) => `${index}-${item.type_id}`}
          renderItem={({ item }) => (
            <Chip
              testID={`home-class-${item.type_id}`}
              label={item.type_name}
              onPress={() =>
                navigation.navigate('Category', { siteKey, typeId: item.type_id, typeName: item.type_name })
              }
            />
          )}
        />
      ) : null}
    </View>
  );
});

function HomeFeed({ site, content, preferFocus }: { site: Site; content: HomeContent; preferFocus: boolean }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const cid = useActiveCid();
  const { config } = useVodConfig();
  const { items: history } = useContinueWatching(navigation);
  const [focused, setFocused] = useState<HeroItem>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const classes = useMemo(() => remainingClasses(content.classes, resolveSections(content.classes)), [content]);

  const onFocusItem = useCallback((item: HeroItem) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocused(item), HERO_FOCUS_DELAY);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const first = content.featured[0];
  // The last focused card stays the hero while the focus is on the hero buttons, so 立即播放 plays what is shown.
  const hero = focused ?? (first ? { siteKey: content.featuredSiteKey, vod: first } : undefined);
  const heroSite = hero && config?.sites.find((item) => item.key === hero.siteKey);

  if (!hero && history.length === 0 && content.rows.length === 0 && classes.length === 0) {
    return <Text style={[styles.note, styles.belowNav]}>暂无内容</Text>;
  }
  return (
    <ScrollView testID="home-feed" contentContainerStyle={styles.feed} showsVerticalScrollIndicator={false}>
      {hero ? (
        <Hero item={hero} siteName={heroSite?.name ?? site.name} cid={cid} preferFocus={preferFocus} />
      ) : (
        <View style={styles.belowNav} />
      )}
      <HomeRows history={history} rows={content.rows} classes={classes} siteKey={site.key} onFocusItem={onFocusItem} />
    </ScrollView>
  );
}

function HomeBody({ section }: { section?: HomeSection }) {
  const styles = useScaledStyles(makeStyles);
  const { config } = useVodConfig();
  const [homeSiteKey] = useSetting('homeSiteKey');
  const [pickerOpen, setPickerOpen] = useState(false);
  const sites = config?.sites ?? [];
  const home = selectHome(sites, homeSiteKey || config?.home?.key);
  const source = useMemo(() => home && createSiteHomeContent(home), [home]);
  const [state, retry] = useHomeContent(source);
  const content = state.status === 'ready' ? state.content : undefined;
  useSectionAvailability(content?.classes);

  let body: ReactElement;
  let overlay = false;
  if (!home) {
    body = <Text style={styles.note}>没有可用站点</Text>;
  } else if (state.status === 'loading') {
    body = <LoadingView />;
  } else if (state.status === 'error') {
    body = <ErrorView testID="home-error" message={state.message} onRetry={retry} hasTVPreferredFocus={!pickerOpen} />;
  } else if (section) {
    const cls = resolveSections(state.content.classes)[section];
    body = cls ? (
      <SectionView key={`${home.key}-${cls.type_id}`} site={home} cls={cls} preferFocus={!pickerOpen} />
    ) : (
      <Text style={styles.note}>当前站点没有此分类</Text>
    );
  } else {
    overlay = true;
    body = <HomeFeed key={home.key} site={home} content={state.content} preferFocus={!pickerOpen} />;
  }

  return (
    <View style={styles.container}>
      {overlay ? body : null}
      <Header section={section} overlay={overlay} onSwitch={() => setPickerOpen(true)} />
      {overlay ? null : body}
      {pickerOpen ? <SitePicker sites={sites} homeKey={home?.key} onClose={() => setPickerOpen(false)} /> : null}
    </View>
  );
}

export default function HomeScreen({ route }: Partial<RootStackScreenProps<'Home'>>) {
  const { status } = useVodConfig();
  const styles = useScaledStyles(makeStyles);
  const section = route?.params?.section;
  if (status === 'ready') return <HomeBody section={section} />;
  return (
    <View style={styles.container}>
      <Header section={section} />
      <ConfigSetup />
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    container: { flex: 1, backgroundColor: color.bg },
    overlay: { position: 'absolute' as const, top: 0, left: 0 },
    belowNav: { marginTop: s(150) },
    feed: { paddingBottom: s(120) },
    rows: { gap: s(space.xs), marginTop: s(12) },
    note: { ...text.body, paddingHorizontal: s(safeArea.horizontal), paddingTop: s(space.lg), color: color.text2 },
  };
};
