import { type ReactNode, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SPEED_PRESETS } from '../../core/settings/schema';
import type { Flag } from '../../core/types';
import type { EnginePreference } from '../../player/engine/policy';
import type { EngineFactory, ExternalSubtitle, Track, TrackId } from '../../player/engine/types';
import { colors, FocusableButton, fontSize, radius, spacing, useLayout } from '../../ui';
import { formatSpeed, subtitleName } from './format';

export type PanelKind = 'episodes' | 'speed' | 'audio' | 'subtitle' | 'engine';

const TITLES: Record<PanelKind, string> = {
  episodes: '选集',
  speed: '倍速',
  audio: '音轨',
  subtitle: '字幕',
  engine: '播放器',
};

/**
 * Modal panel. The hardware back key (Android) and the Menu button (tvOS)
 * call onRequestClose, so back closes the panel before leaving the player.
 */
export function Panel({ kind, onClose, children }: { kind: PanelKind; onClose: () => void; children: ReactNode }) {
  const { isTV } = useLayout();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID={`player-panel-${kind}`} style={[styles.panel, isTV ? styles.panelTV : styles.panelPhone]}>
          <Text style={styles.title}>{TITLES[kind]}</Text>
          {children}
          <FocusableButton testID="player-panel-close" title="关闭" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export function EpisodePanel({
  flags,
  flagIndex,
  episodeIndex,
  onSelect,
}: {
  flags: Flag[];
  flagIndex: number;
  episodeIndex: number;
  onSelect: (episodeIndex: number, flagIndex: number) => void;
}) {
  const { isTV } = useLayout();
  const [shownFlag, setShownFlag] = useState(flagIndex);
  const episodes = flags[shownFlag]?.episodes ?? [];
  return (
    <>
      {flags.length > 1 ? (
        <ScrollView horizontal style={styles.flags}>
          {flags.map((flag, index) => (
            <FocusableButton
              key={`${index}-${flag.flag}`}
              testID={`player-flag-${index}`}
              title={flag.flag}
              selected={index === shownFlag}
              onPress={() => setShownFlag(index)}
            />
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        key={isTV ? 'tv' : 'phone'}
        style={styles.list}
        data={episodes}
        numColumns={isTV ? 6 : 4}
        keyExtractor={(item, index) => `${index}-${item.url}`}
        renderItem={({ item, index }) => {
          const current = shownFlag === flagIndex && index === episodeIndex;
          return (
            <FocusableButton
              testID={`player-episode-${index}`}
              style={styles.cell}
              title={item.name}
              selected={current}
              hasTVPreferredFocus={current}
              onPress={() => onSelect(index, shownFlag)}
            />
          );
        }}
      />
    </>
  );
}

export function SpeedPanel({ speed, onSelect }: { speed: number; onSelect: (speed: number) => void }) {
  return (
    <View style={styles.wrap}>
      {SPEED_PRESETS.map((value) => (
        <FocusableButton
          key={value}
          testID={`player-speed-${value}`}
          title={formatSpeed(value)}
          selected={value === speed}
          hasTVPreferredFocus={value === speed}
          onPress={() => onSelect(value)}
        />
      ))}
    </View>
  );
}

function isSelected(track: Track, selected: TrackId | null | undefined): boolean {
  return selected === undefined ? !!track.selected : track.id === selected;
}

function trackLabel(track: Track, index: number): string {
  return track.label || track.language || `轨道 ${index + 1}`;
}

export function AudioPanel({
  tracks,
  selected,
  onSelect,
}: {
  tracks: Track[];
  selected?: TrackId;
  onSelect: (id: TrackId) => void;
}) {
  if (tracks.length === 0) return <Text style={styles.note}>没有可选的音轨</Text>;
  return (
    <ScrollView style={styles.list}>
      {tracks.map((track, index) => (
        <FocusableButton
          key={String(track.id)}
          testID={`player-audio-${track.id}`}
          title={trackLabel(track, index)}
          selected={isSelected(track, selected)}
          hasTVPreferredFocus={index === 0}
          onPress={() => onSelect(track.id)}
        />
      ))}
    </ScrollView>
  );
}

export function SubtitlePanel({
  tracks,
  selected,
  external,
  onSelect,
  onAdd,
}: {
  tracks: Track[];
  /** null = subtitles off. */
  selected?: TrackId | null;
  /** Result.subs and subtitles added by URL. */
  external: ExternalSubtitle[];
  onSelect: (id: TrackId | null) => void;
  onAdd: (subtitle: ExternalSubtitle) => void;
}) {
  const [url, setUrl] = useState('');
  const add = () => {
    const value = url.trim();
    if (!value) return;
    onAdd({ url: value, name: subtitleName(value) });
    setUrl('');
  };
  // An external subtitle the engine already lists as a text track is selected directly.
  const pickExternal = (subtitle: ExternalSubtitle) => {
    const track = tracks.find((item) => item.label === subtitle.name);
    if (track) onSelect(track.id);
    else onAdd(subtitle);
  };
  const shownExternal = external.filter((subtitle) => !tracks.some((track) => track.label === subtitle.name));
  return (
    <ScrollView style={styles.list}>
      <FocusableButton
        testID="player-subtitle-off"
        title="关闭"
        selected={selected === null}
        hasTVPreferredFocus
        onPress={() => onSelect(null)}
      />
      {tracks.map((track, index) => (
        <FocusableButton
          key={String(track.id)}
          testID={`player-subtitle-${track.id}`}
          title={trackLabel(track, index)}
          selected={selected !== null && isSelected(track, selected)}
          onPress={() => onSelect(track.id)}
        />
      ))}
      {shownExternal.map((subtitle) => (
        <FocusableButton
          key={subtitle.url}
          testID={`player-subtitle-external-${subtitle.name}`}
          title={`外挂：${subtitle.name}`}
          onPress={() => pickExternal(subtitle)}
        />
      ))}
      <View style={styles.form}>
        <TextInput
          testID="player-subtitle-url"
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          onSubmitEditing={add}
          placeholder="输入字幕地址"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <FocusableButton testID="player-subtitle-add" title="添加字幕" disabled={!url.trim()} onPress={add} />
      </View>
    </ScrollView>
  );
}

export function EnginePanel({
  engines,
  preference,
  active,
  onSelect,
}: {
  engines: EngineFactory[];
  preference: EnginePreference;
  active?: EngineFactory;
  onSelect: (preference: EnginePreference) => void;
}) {
  return (
    <View>
      {active ? <Text style={styles.note}>{`当前：${active.label}`}</Text> : null}
      <FocusableButton
        testID="player-engine-auto"
        title="自动"
        selected={preference === 'auto'}
        hasTVPreferredFocus={preference === 'auto'}
        onPress={() => onSelect('auto')}
      />
      {engines.map((engine) => (
        <FocusableButton
          key={engine.kind}
          testID={`player-engine-${engine.kind}`}
          title={engine.label}
          selected={preference === engine.kind}
          disabled={!engine.isAvailable()}
          hasTVPreferredFocus={preference === engine.kind}
          onPress={() => onSelect(engine.kind)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.remarkBackground,
  },
  panel: {
    maxHeight: '90%',
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  panelTV: {
    width: '60%',
  },
  panelPhone: {
    width: '92%',
  },
  title: {
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  flags: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  cell: {
    flex: 1,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  note: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  form: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.sm,
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
});
