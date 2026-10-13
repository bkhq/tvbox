import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Channel, Group } from '../../core/types';
import { currentProgrammeIndex, formatEpgItem } from '../../player/live';
import { colors, FocusableButton, fontSize, imageSource, radius, spacing } from '../../ui';
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

function ChannelRow({
  channel,
  logo,
  programme,
  playing,
  preferred,
  testID,
  onFocus,
  onPress,
}: {
  channel: Channel;
  logo: string;
  programme: string;
  playing: boolean;
  preferred: boolean;
  testID: string;
  onFocus(): void;
  onPress(): void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.row, playing && styles.rowPlaying, focused && styles.rowFocused]}
    >
      <Text style={styles.number}>{channel.number}</Text>
      {logo !== '' ? <Image source={imageSource(logo)} style={styles.logo} resizeMode="contain" /> : <View style={styles.logo} />}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        {programme !== '' ? (
          <Text style={styles.programme} numberOfLines={1}>
            {programme}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * LiveActivity's list: group column, channel column (number, logo, current
 * programme) and on TV the programme guide of the focused channel. Pressing a
 * channel plays it; back (Menu on tvOS) closes the list.
 */
export function ChannelList({ groups, selection, epg, isTV, onGroupPress, onSelect, onClose, onMenu, onBack }: ChannelListProps) {
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
            ListHeaderComponent={
              <>
                {onBack ? <FocusableButton testID="live-back" title="返回" onPress={onBack} /> : null}
                <FocusableButton testID="live-menu" title="直播源" onPress={onMenu} />
              </>
            }
            data={groups}
            keyExtractor={(group, index) => `${index}-${group.name}`}
            renderItem={({ item, index }) => (
              <FocusableButton
                testID={`live-group-${index}`}
                title={item.name}
                selected={index === shownGroup}
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
              data={guideEpg?.list ?? []}
              keyExtractor={(item, index) => `${index}-${item.startTime}`}
              ListEmptyComponent={<Text style={styles.empty}>暂无节目信息</Text>}
              renderItem={({ item, index }) => (
                <Text style={[styles.guideItem, index === nowIndex && styles.guideNow]} numberOfLines={1}>
                  {formatEpgItem(item)}
                </Text>
              )}
            />
          ) : null}
        </View>
        <Pressable testID="live-list-dismiss" style={styles.dismiss} onPress={onClose} focusable={false} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'row',
  },
  panel: {
    flexDirection: 'row',
    maxWidth: '90%',
    padding: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  dismiss: {
    flex: 1,
  },
  groups: {
    width: 150,
  },
  channels: {
    width: 280,
  },
  guide: {
    width: 300,
    paddingLeft: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    margin: 2,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  rowPlaying: {
    backgroundColor: colors.surface,
  },
  rowFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.surfaceFocused,
  },
  number: {
    width: 36,
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  logo: {
    width: 48,
    height: 28,
    marginRight: spacing.sm,
  },
  rowText: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: fontSize.body,
  },
  programme: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  guideItem: {
    paddingVertical: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  guideNow: {
    color: colors.primary,
  },
  empty: {
    padding: spacing.md,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
