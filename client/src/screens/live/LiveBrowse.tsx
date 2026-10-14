import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Channel, Group } from '../../core/types';
import { useMainNav } from '../../navigation/mainNav';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { sameChannel } from '../../player/live/channel';
import {
  AnimatedPressable,
  Badge,
  Button,
  ChannelCard,
  color,
  focus,
  FocusRing,
  fontFamily,
  Icon,
  imageSource,
  radii,
  type Scaler,
  scaledText,
  tabular,
  TopNav,
  useFocusAnimation,
  useScale,
  useScaledStyles,
} from '../../ui';
import { isFavourite } from './liveFavourites';
import {
  channelNumberLabel,
  itemForSelection,
  type LiveChannelRef,
  type LiveGroupItem,
  liveGroupChannels,
  liveGroupItems,
  type LiveSelection,
  lineLabel,
  nowAndNext,
  programmeProgress,
} from './liveModel';
import type { LiveEpg } from './useLiveEpg';

export interface LiveBrowseProps {
  groups: Group[];
  selection: LiveSelection;
  epg: LiveEpg;
  /** A press on a group item; `groupIndex` is undefined for "全部". */
  onGroupPress(groupIndex: number | undefined): void;
  /** Plays a channel and stays in browse. */
  onSelect(ref: LiveChannelRef): void;
  onFull(): void;
  onToggleFavourite(channel: Channel): void;
}

// Channel tile of the live mockup plus the row gap.
const CARD_WIDTH = 260;
const CARD_GAP = 16;
const GROUP_WIDTH = 200;
const COLUMN_GAP = 40;
const FAV_SIZE = 44;
const PROGRESS_TICK = 30_000;

const sameRef = (a: LiveChannelRef, b: LiveChannelRef) => a.group === b.group && a.channel === b.channel;

function holds(groups: Group[], item: LiveGroupItem | undefined, selection: LiveSelection): boolean {
  return !!item && liveGroupChannels(groups, item).some((ref) => sameRef(ref, selection));
}

/** The item holding the playing channel: "收藏" / "全部", else its own group. */
function defaultItem(items: LiveGroupItem[], groups: Group[], selection: LiveSelection): LiveGroupItem {
  const preferred = itemForSelection(items, groups, selection);
  if (preferred && holds(groups, preferred, selection)) return preferred;
  return items.find((item) => item.groupIndex === selection.group) ?? items[0]!;
}

/** Live home of the TV design: the playing channel as the backdrop, groups, current channel and a channel row. */
export function LiveBrowse({
  groups,
  selection,
  epg,
  onGroupPress,
  onSelect,
  onFull,
  onToggleFavourite,
}: LiveBrowseProps) {
  const navigation = useAppNavigation();
  const nav = useMainNav('live');
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), PROGRESS_TICK);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo(() => liveGroupItems(groups), [groups]);
  // The row shows the picked group; a channel change outside it (LAN select) brings back the playing one.
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const pickedItem = items.find((entry) => entry.key === picked);
  const [seen, setSeen] = useState(selection);
  if (!sameRef(seen, selection)) {
    setSeen(selection);
    if (pickedItem && !holds(groups, pickedItem, selection)) setPicked(undefined);
  }
  const item = pickedItem ?? defaultItem(items, groups, selection);
  const refs = useMemo(() => liveGroupChannels(groups, item), [groups, item]);

  const channel = groups[selection.group]!.channel[selection.channel]!;
  const rowIndex = refs.findIndex((ref) => sameRef(ref, selection));
  const { current } = nowAndNext(epg.epgFor(channel), now);
  const progress = programmeProgress(current, now);
  const line = lineLabel(channel, selection.line);
  const logo = epg.logoOf(channel);
  const favourite = isFavourite(groups, channel);

  const pickItem = (next: LiveGroupItem) => setPicked(next.key);

  return (
    <View style={StyleSheet.absoluteFill} testID="live-browse">
      <Svg style={styles.topFade} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="liveTopFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bg} stopOpacity={0.92} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#liveTopFade)" />
      </Svg>
      <Svg style={styles.bottomFade} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="liveBottomFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={0.94} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#liveBottomFade)" />
      </Svg>
      <TopNav
        items={nav.items}
        onSelect={nav.select}
        onSearch={() => navigation.navigate('Search')}
        right={
          <>
            <Button
              testID="live-nav-control"
              variant="icon"
              size="md"
              icon="phone"
              accessibilityLabel="手机控制"
              onPress={() => navigation.navigate('Control')}
            />
            <Button
              testID="live-nav-settings"
              variant="icon"
              size="md"
              icon="settings"
              accessibilityLabel="设置"
              onPress={() => navigation.navigate('Settings')}
            />
          </>
        }
      />
      <View style={styles.bottom}>
        <TVFocusGuideView autoFocus style={styles.groups}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.groupList}>
            {items.map((entry) => (
              <GroupItem
                key={entry.key}
                item={entry}
                active={entry.key === item.key}
                onFocus={() => pickItem(entry)}
                onPress={() => {
                  pickItem(entry);
                  onGroupPress(entry.groupIndex);
                }}
              />
            ))}
          </ScrollView>
        </TVFocusGuideView>
        <View style={styles.main}>
          <View style={styles.header}>
            <View style={styles.current}>
              <Text style={styles.number} testID="live-browse-number">
                {channelNumberLabel(channel, rowIndex >= 0 ? rowIndex : selection.channel)}
              </Text>
              <View style={styles.info}>
                <View style={styles.titleRow}>
                  <Text style={styles.name} numberOfLines={1} testID="live-browse-name">
                    {channel.name}
                  </Text>
                  {line !== '' ? <Badge label={line} testID="live-browse-line" /> : null}
                  {logo !== '' ? <Image source={imageSource(logo)} style={styles.logo} resizeMode="contain" /> : null}
                  <FavouriteButton favourite={favourite} onPress={() => onToggleFavourite(channel)} />
                </View>
                {current ? (
                  <View style={styles.programme}>
                    <Text style={styles.programmeTitle} numberOfLines={1} testID="live-browse-programme">
                      {current.title}
                    </Text>
                    {progress ? (
                      <>
                        <Text style={styles.time}>{progress.start}</Text>
                        <View style={styles.track}>
                          <View
                            testID="live-browse-progress"
                            style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%` }]}
                          />
                        </View>
                        <Text style={styles.time}>{progress.end}</Text>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
            <Button testID="live-browse-full" title="全屏观看" icon="fullscreen" size="md" onPress={onFull} />
          </View>
          <TVFocusGuideView autoFocus trapFocusRight>
            <FlatList
              key={item.key}
              testID="live-browse-cards"
              horizontal
              data={refs}
              keyExtractor={(ref) => `${ref.group}-${ref.channel}`}
              initialScrollIndex={rowIndex > 0 ? rowIndex : undefined}
              getItemLayout={(_, index) => ({
                length: s(CARD_WIDTH + CARD_GAP),
                offset: s(focus.bleed) + index * s(CARD_WIDTH + CARD_GAP),
                index,
              })}
              initialNumToRender={8}
              maxToRenderPerBatch={4}
              windowSize={3}
              showsHorizontalScrollIndicator={false}
              style={styles.cards}
              contentContainerStyle={styles.cardsContent}
              renderItem={({ item: ref, index }) => {
                const target = groups[ref.group]!.channel[ref.channel]!;
                const playing = sameRef(ref, selection) || sameChannel(target, channel);
                return (
                  <ChannelCard
                    testID={`live-browse-card-${index}`}
                    style={styles.card}
                    number={channelNumberLabel(target, index)}
                    name={target.name}
                    program={nowAndNext(epg.epgFor(target), now).current?.title}
                    logo={target.logo || undefined}
                    playing={playing}
                    favourite={isFavourite(groups, target)}
                    hasTVPreferredFocus={playing}
                    onFocus={() => epg.request(target)}
                    onPress={() => (playing ? onFull() : onSelect(ref))}
                    onLongPress={() => onToggleFavourite(target)}
                  />
                );
              }}
            />
          </TVFocusGuideView>
        </View>
      </View>
    </View>
  );
}

function GroupItem({
  item,
  active,
  onFocus,
  onPress,
}: {
  item: LiveGroupItem;
  active: boolean;
  onFocus(): void;
  onPress(): void;
}) {
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus });
  return (
    <AnimatedPressable
      testID={`live-browse-group-${item.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} ${item.count}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...handlers}
      style={[styles.group, active && styles.groupActive, animatedStyle]}
    >
      {focused ? <FocusRing radius={s(radii.card + 2)} /> : null}
      <Text numberOfLines={1} style={[styles.groupName, active && styles.groupNameActive]}>
        {item.name}
      </Text>
      <Text style={[styles.groupCount, active && styles.groupCountActive]}>{item.count}</Text>
    </AnimatedPressable>
  );
}

function FavouriteButton({ favourite, onPress }: { favourite: boolean; onPress(): void }) {
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const { focused, animatedStyle, handlers } = useFocusAnimation();
  const tint = favourite ? color.accent : focused ? color.inverseText : color.text;
  return (
    <AnimatedPressable
      testID="live-browse-favourite"
      accessibilityRole="button"
      accessibilityLabel="收藏频道"
      accessibilityState={{ selected: favourite }}
      onPress={onPress}
      {...handlers}
      style={[styles.favourite, focused && styles.favouriteFocused, animatedStyle]}
    >
      {focused ? <FocusRing radius={s(FAV_SIZE) / 2} /> : null}
      <Icon name={favourite ? 'heartFilled' : 'heart'} size={24} color={tint} />
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => {
  const { display, h1, body, label, caption } = scaledText(s);
  return {
    topFade: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: s(220) },
    bottomFade: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: s(520) },
    bottom: {
      position: 'absolute' as const,
      left: s(96),
      right: 0,
      bottom: s(64),
      flexDirection: 'row' as const,
      alignItems: 'flex-end' as const,
      gap: s(COLUMN_GAP),
    },
    groups: { width: s(GROUP_WIDTH), maxHeight: s(600) },
    groupList: { gap: s(8), paddingVertical: s(focus.ringGap + focus.ringWidth) },
    group: {
      height: s(60),
      paddingHorizontal: s(20),
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      borderRadius: s(12),
    },
    groupActive: { backgroundColor: color.surface2 },
    groupName: { ...label, flexShrink: 1, color: color.text2 },
    groupNameActive: { fontFamily: fontFamily.bold, color: color.text },
    groupCount: { ...caption, ...tabular, color: color.text3 },
    groupCountActive: { color: color.text2 },
    main: { flex: 1, minWidth: 0, gap: s(20) },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'flex-end' as const,
      justifyContent: 'space-between' as const,
      gap: s(28),
      paddingRight: s(96),
    },
    current: { flexShrink: 1, minWidth: 0, flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: s(28) },
    number: { ...display, ...tabular, color: color.text },
    info: { flexShrink: 1, minWidth: 0, gap: s(10), marginBottom: s(4) },
    titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(14) },
    name: { ...h1, flexShrink: 1, color: color.text },
    logo: { width: s(80), height: s(44) },
    programme: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(16) },
    programmeTitle: { ...body, flexShrink: 1, color: color.text },
    time: { ...caption, ...tabular, color: color.text2 },
    track: { width: s(320), height: s(6), borderRadius: s(3), backgroundColor: 'rgba(255,255,255,0.25)' },
    fill: { height: s(6), borderRadius: s(3), backgroundColor: color.accent },
    favourite: {
      width: s(FAV_SIZE),
      height: s(FAV_SIZE),
      borderRadius: s(FAV_SIZE) / 2,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: color.buttonFill,
    },
    favouriteFocused: { backgroundColor: focus.borderColor },
    // Starts a bleed left of the column so the first card's focus zoom is not clipped.
    cards: { marginLeft: -s(focus.bleed), overflow: 'visible' as const },
    cardsContent: { paddingVertical: s(focus.bleed), paddingLeft: s(focus.bleed), paddingRight: s(96) },
    card: { marginRight: s(CARD_GAP) },
  };
};
