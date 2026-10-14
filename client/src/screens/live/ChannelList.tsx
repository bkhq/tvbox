import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, Text, View } from 'react-native';

import type { Channel, Group } from '../../core/types';
import { currentProgrammeIndex } from '../../player/live';
import {
  AnimatedPressable,
  Badge,
  Button,
  color,
  focus,
  FocusRing,
  imageSource,
  radii,
  safeArea,
  type Scaler,
  scaledText,
  space,
  tabular,
  useFocusAnimation,
  useScaledStyles,
} from '../../ui';
import { type LiveSelection, nowAndNext } from './liveModel';
import type { LiveEpg } from './useLiveEpg';

export interface ChannelListProps {
  groups: Group[];
  selection: LiveSelection;
  epg: LiveEpg;
  /** Adds the EPG column of the focused channel. */
  isTV: boolean;
  onGroupPress(groupIndex: number): void;
  onSelect(groupIndex: number, channelIndex: number): void;
  onClose(): void;
  /** Opens the live source panel (phones have no menu key). */
  onMenu(): void;
  /** Leaves the screen; phones only (the header is hidden). */
  onBack?: () => void;
}

type Styles = ReturnType<typeof makeStyles>;

/** Group list row: name and channel count; selected = surface-2 fill, focused = inverted. */
function GroupRow({
  group,
  selected,
  styles,
  testID,
  onPress,
}: {
  group: Group;
  selected: boolean;
  styles: Styles;
  testID: string;
  onPress(): void;
}) {
  const { focused, animatedStyle, handlers } = useFocusAnimation();
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={group.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      {...handlers}
      style={[styles.group, selected && styles.groupSelected, focused && styles.groupFocused, animatedStyle]}
    >
      {focused ? <FocusRing radius={styles.group.borderRadius} /> : null}
      <Text
        style={[styles.groupName, selected && styles.groupNameSelected, focused && styles.inverse]}
        numberOfLines={1}
      >
        {group.name}
      </Text>
      <Text style={[styles.groupCount, selected && styles.groupCountSelected, focused && styles.inverse]}>
        {String(group.channel.length)}
      </Text>
    </AnimatedPressable>
  );
}

function ChannelRow({
  channel,
  logo,
  programme,
  playing,
  preferred,
  styles,
  testID,
  onFocus,
  onPress,
}: {
  channel: Channel;
  logo: string;
  programme: string;
  playing: boolean;
  preferred: boolean;
  styles: Styles;
  testID: string;
  onFocus(): void;
  onPress(): void;
}) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus });
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      {...handlers}
      style={[styles.row, playing && styles.rowPlaying, focused && styles.rowFocused, animatedStyle]}
    >
      <Text style={[styles.number, playing && styles.numberPlaying]} numberOfLines={1}>
        {channel.number}
      </Text>
      {logo !== '' ? <Image source={imageSource(logo)} style={styles.logo} resizeMode="contain" resizeMethod="resize" /> : null}
      <View style={styles.rowText}>
        <View style={styles.rowTitle}>
          <Text style={styles.name} numberOfLines={1}>
            {channel.name}
          </Text>
          {playing ? <Badge testID={`${testID}-playing`} variant="live" label="正在看" /> : null}
        </View>
        {programme !== '' ? (
          <Text style={styles.programme} numberOfLines={1}>
            {programme}
          </Text>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

/**
 * LiveActivity's list: group column, channel column (number, logo, current
 * programme) and on TV the programme guide of the focused channel. Pressing a
 * channel plays it; back (Menu on tvOS) closes the list.
 */
export function ChannelList({
  groups,
  selection,
  epg,
  isTV,
  onGroupPress,
  onSelect,
  onClose,
  onMenu,
  onBack,
}: ChannelListProps) {
  const styles = useScaledStyles(makeStyles);
  const [shownGroup, setShownGroup] = useState(selection.group);
  const [focusedChannel, setFocusedChannel] = useState(selection.channel);
  const channels = groups[shownGroup]?.channel ?? [];
  const guideChannel = channels[focusedChannel];
  const guideEpg = guideChannel ? epg.epgFor(guideChannel) : undefined;
  const nowIndex = guideEpg ? currentProgrammeIndex(guideEpg) : -1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="live-list" style={styles.panel}>
          <FlatList
            testID="live-groups"
            style={styles.groups}
            contentContainerStyle={styles.columnContent}
            ListHeaderComponent={
              <View style={styles.actions}>
                {onBack ? <Button testID="live-back" icon="back" title="返回" size="md" onPress={onBack} /> : null}
                <Button testID="live-menu" icon="switch" title="直播源" size="md" onPress={onMenu} />
              </View>
            }
            data={groups}
            keyExtractor={(group, index) => `${index}-${group.name}`}
            renderItem={({ item, index }) => (
              <GroupRow
                testID={`live-group-${index}`}
                group={item}
                selected={index === shownGroup}
                styles={styles}
                onPress={() => {
                  setShownGroup(index);
                  setFocusedChannel(0);
                  onGroupPress(index);
                }}
              />
            )}
          />
          <FlatList
            testID="live-channels"
            style={styles.channels}
            contentContainerStyle={styles.columnContent}
            data={channels}
            extraData={epg}
            keyExtractor={(channel, index) => `${index}-${channel.name}`}
            ListEmptyComponent={<Text style={styles.empty}>暂无频道</Text>}
            renderItem={({ item, index }) => {
              const playing = shownGroup === selection.group && index === selection.channel;
              const current = nowAndNext(epg.epgFor(item)).current;
              return (
                <ChannelRow
                  testID={`live-channel-${index}`}
                  channel={item}
                  logo={epg.logoOf(item)}
                  programme={current?.title ?? ''}
                  playing={playing}
                  preferred={playing}
                  styles={styles}
                  onFocus={() => {
                    setFocusedChannel(index);
                    epg.request(item);
                  }}
                  onPress={() => onSelect(shownGroup, index)}
                />
              );
            }}
          />
          {isTV ? (
            <FlatList
              testID="live-epg"
              style={styles.guide}
              contentContainerStyle={styles.columnContent}
              ListHeaderComponent={
                guideChannel ? (
                  <Text style={styles.guideTitle} numberOfLines={1}>
                    {guideChannel.name}
                  </Text>
                ) : null
              }
              data={guideEpg?.list ?? []}
              keyExtractor={(item, index) => `${index}-${item.startTime}`}
              ListEmptyComponent={<Text style={styles.empty}>暂无节目信息</Text>}
              renderItem={({ item, index }) => {
                const now = index === nowIndex;
                return (
                  <View style={[styles.guideItem, now && styles.guideItemNow]}>
                    <Text style={[styles.guideTime, now && styles.guideNow]}>
                      {item.start !== '' || item.end !== '' ? `${item.start} ~ ${item.end}` : ''}
                    </Text>
                    <Text style={[styles.guideName, now && styles.guideNow]} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </View>
                );
              }}
            />
          ) : null}
        </View>
        <Pressable testID="live-list-dismiss" style={styles.dismiss} onPress={onClose} focusable={false} />
      </View>
    </Modal>
  );
}

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    backdrop: { flex: 1, flexDirection: 'row' as const },
    panel: {
      flexDirection: 'row' as const,
      maxWidth: '90%' as const,
      gap: s(space.md),
      paddingLeft: s(safeArea.horizontal - focus.bleed),
      paddingRight: s(space.md),
      paddingVertical: s(safeArea.vertical - focus.bleed),
      backgroundColor: 'rgba(11,14,20,0.94)',
      borderRightWidth: s(1),
      borderRightColor: color.divider,
    },
    dismiss: { flex: 1 },
    columnContent: { gap: s(space.xs), padding: s(focus.bleed) },
    groups: { width: s(240 + 2 * focus.bleed), flexGrow: 0 },
    channels: { width: s(520 + 2 * focus.bleed), flexGrow: 0 },
    guide: { width: s(440 + 2 * focus.bleed), flexGrow: 0 },
    actions: { gap: s(space.sm), marginBottom: s(space.sm) },
    group: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      height: s(60),
      paddingHorizontal: s(20),
      borderRadius: s(12),
    },
    groupSelected: { backgroundColor: color.surface2 },
    groupFocused: { backgroundColor: color.focusBorder },
    groupName: { ...t.label, flexShrink: 1, color: color.text2 },
    groupNameSelected: { ...t.label, fontFamily: t.h1.fontFamily, color: color.text },
    groupCount: { ...t.caption, ...tabular, marginLeft: s(space.xs), color: color.text3 },
    groupCountSelected: { color: color.text2 },
    inverse: { color: color.inverseText },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(space.sm),
      minHeight: s(96),
      paddingHorizontal: s(18),
      paddingVertical: s(12),
      borderRadius: s(radii.button),
      borderWidth: s(focus.borderWidth),
      borderColor: 'transparent',
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    rowPlaying: { backgroundColor: 'rgba(255,255,255,0.14)' },
    rowFocused: { borderColor: focus.borderColor, backgroundColor: color.surface2 },
    number: { ...t.h2, ...tabular, width: s(72), color: color.text2 },
    numberPlaying: { color: color.text },
    logo: { width: s(64), height: s(36) },
    rowText: { flex: 1, gap: s(4) },
    rowTitle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(12) },
    name: { ...t.label, fontFamily: t.h2.fontFamily, flexShrink: 1, color: color.text },
    programme: { ...t.caption, color: color.text3 },
    guideTitle: { ...t.h2, marginBottom: s(space.xs), color: color.text },
    guideItem: {
      gap: s(2),
      paddingVertical: s(10),
      paddingLeft: s(space.sm),
      borderLeftWidth: s(4),
      borderLeftColor: 'transparent',
    },
    guideItemNow: { borderLeftColor: color.accent, borderRadius: s(radii.tag), backgroundColor: color.surface },
    guideTime: { ...t.caption, ...tabular, color: color.text3 },
    guideName: { ...t.label, color: color.text2 },
    guideNow: { color: color.accent },
    empty: { ...t.label, padding: s(space.md), color: color.text2 },
  };
};
