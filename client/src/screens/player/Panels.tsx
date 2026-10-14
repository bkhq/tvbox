import { type ReactNode, useState } from 'react';
import { FlatList, Modal, ScrollView, Text, TextInput, View } from 'react-native';

import { SPEED_PRESETS } from '../../core/settings/schema';
import type { Flag } from '../../core/types';
import type { EnginePreference } from '../../player/engine/policy';
import type { EngineFactory, ExternalSubtitle, Track, TrackId } from '../../player/engine/types';
import { Button, Chip, color, focus, radii, safeArea, type Scaler, scaledText, space, useScaledStyles } from '../../ui';
import { choiceOptions } from '../settings/options';
import { formatSpeed, subtitleName, trackLabel } from './format';

export type PanelKind = 'episodes' | 'speed' | 'audio' | 'subtitle' | 'engine' | 'line' | 'settings';

const TITLES: Record<PanelKind, string> = {
  episodes: '选集',
  speed: '倍速',
  audio: '音轨',
  subtitle: '字幕',
  engine: '播放器',
  line: '画质',
  settings: '设置',
};

/** Episode grid columns; the sheet keeps one layout on TV and phone. */
const EPISODE_COLUMNS = 4;

/**
 * Right-side modal sheet. The hardware back key (Android) and the Menu button
 * (tvOS) call onRequestClose, so back closes the panel before leaving the player.
 */
export function Panel({ kind, onClose, children }: { kind: PanelKind; onClose: () => void; children: ReactNode }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID={`player-panel-${kind}`} style={styles.sheet}>
          <Text style={styles.title}>{TITLES[kind]}</Text>
          <View style={styles.body}>{children}</View>
          <Button testID="player-panel-close" size="md" title="关闭" style={styles.close} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** A full-width option row: accent fill when selected, inverted with a ring when focused. */
function Option({
  selected,
  ...props
}: { testID: string; title: string; selected?: boolean; disabled?: boolean; hasTVPreferredFocus?: boolean; onPress: () => void }) {
  const styles = useScaledStyles(makeStyles);
  return <Button size="md" variant={selected ? 'primary' : 'secondary'} style={styles.option} {...props} />;
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
  const styles = useScaledStyles(makeStyles);
  const [shownFlag, setShownFlag] = useState(flagIndex);
  const episodes = flags[shownFlag]?.episodes ?? [];
  return (
    <>
      {flags.length > 1 ? (
        <ScrollView horizontal style={styles.flags} contentContainerStyle={styles.chips}>
          {flags.map((flag, index) => (
            <Chip
              key={`${index}-${flag.flag}`}
              testID={`player-flag-${index}`}
              label={flag.flag}
              selected={index === shownFlag}
              onPress={() => setShownFlag(index)}
            />
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.bleed}
        data={episodes}
        numColumns={EPISODE_COLUMNS}
        keyExtractor={(item, index) => `${index}-${item.url}`}
        renderItem={({ item, index }) => {
          const current = shownFlag === flagIndex && index === episodeIndex;
          return (
            <Button
              testID={`player-episode-${index}`}
              size="md"
              variant={current ? 'primary' : 'secondary'}
              style={styles.cell}
              title={item.name}
              hasTVPreferredFocus={current}
              onPress={() => onSelect(index, shownFlag)}
            />
          );
        }}
      />
    </>
  );
}

export function LinePanel({
  flags,
  flagIndex,
  onSelect,
}: {
  flags: Flag[];
  flagIndex: number;
  onSelect: (flagIndex: number) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.bleed}>
      {flags.map((flag, index) => (
        <Option
          key={`${index}-${flag.flag}`}
          testID={`player-line-${index}`}
          title={flag.flag}
          selected={index === flagIndex}
          hasTVPreferredFocus={index === flagIndex}
          onPress={() => onSelect(index)}
        />
      ))}
    </ScrollView>
  );
}

export function SpeedPanel({ speed, onSelect }: { speed: number; onSelect: (speed: number) => void }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={[styles.chips, styles.wrap, styles.bleed]}>
      {SPEED_PRESETS.map((value) => (
        <Chip
          key={value}
          testID={`player-speed-${value}`}
          label={formatSpeed(value)}
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

export function AudioPanel({
  tracks,
  selected,
  onSelect,
}: {
  tracks: Track[];
  selected?: TrackId;
  onSelect: (id: TrackId) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  if (tracks.length === 0) return <Text style={styles.note}>没有可选的音轨</Text>;
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.bleed}>
      {tracks.map((track, index) => (
        <Option
          key={String(track.id)}
          testID={`player-audio-${track.id}`}
          title={trackLabel(track) ?? `音轨 ${index + 1}`}
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
  const styles = useScaledStyles(makeStyles);
  const [url, setUrl] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
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
    <ScrollView style={styles.list} contentContainerStyle={styles.bleed}>
      <Option
        testID="player-subtitle-off"
        title="关闭"
        selected={selected === null}
        hasTVPreferredFocus
        onPress={() => onSelect(null)}
      />
      {tracks.map((track, index) => (
        <Option
          key={String(track.id)}
          testID={`player-subtitle-${track.id}`}
          title={trackLabel(track) ?? `字幕 ${index + 1}`}
          selected={selected !== null && isSelected(track, selected)}
          onPress={() => onSelect(track.id)}
        />
      ))}
      {shownExternal.map((subtitle) => (
        <Option
          key={subtitle.url}
          testID={`player-subtitle-external-${subtitle.name}`}
          title={`外挂：${subtitle.name}`}
          onPress={() => pickExternal(subtitle)}
        />
      ))}
      <View style={styles.form}>
        <TextInput
          testID="player-subtitle-url"
          style={[styles.input, inputFocused && styles.inputFocused]}
          value={url}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onChangeText={setUrl}
          onSubmitEditing={add}
          placeholder="输入字幕地址"
          placeholderTextColor={color.text3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Button testID="player-subtitle-add" size="md" title="添加字幕" disabled={!url.trim()} onPress={add} />
      </View>
    </ScrollView>
  );
}

interface EngineOptionsProps {
  engines: EngineFactory[];
  preference: EnginePreference;
  active?: EngineFactory;
  onSelect: (preference: EnginePreference) => void;
}

/** Engine choices shared by EnginePanel and SettingsPanel; testIDs are `<prefix>-auto` / `<prefix>-<kind>`. */
function EngineOptions({ engines, preference, active, onSelect, prefix }: EngineOptionsProps & { prefix: string }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <>
      {active ? <Text style={styles.note}>{`当前：${active.label}`}</Text> : null}
      <Option
        testID={`${prefix}-auto`}
        title="自动"
        selected={preference === 'auto'}
        hasTVPreferredFocus={preference === 'auto'}
        onPress={() => onSelect('auto')}
      />
      {engines.map((engine) => (
        <Option
          key={engine.kind}
          testID={`${prefix}-${engine.kind}`}
          title={engine.label}
          selected={preference === engine.kind}
          disabled={!engine.isAvailable()}
          hasTVPreferredFocus={preference === engine.kind}
          onPress={() => onSelect(engine.kind)}
        />
      ))}
    </>
  );
}

export function EnginePanel(props: EngineOptionsProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.bleed}>
      <EngineOptions {...props} prefix="player-engine" />
    </View>
  );
}

/** The `scale` setting values, worded as on the settings screen. */
const SCALE_OPTIONS = choiceOptions('scale');

export function SettingsPanel({
  engines,
  preference,
  active,
  scale,
  onSelectEngine,
  onSelectScale,
}: {
  engines: EngineFactory[];
  preference: EnginePreference;
  active?: EngineFactory;
  scale: number;
  onSelectEngine: (preference: EnginePreference) => void;
  onSelectScale: (scale: number) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.bleed}>
      <Text style={styles.section}>播放器</Text>
      <EngineOptions
        engines={engines}
        preference={preference}
        active={active}
        onSelect={onSelectEngine}
        prefix="player-settings-engine"
      />
      <Text style={styles.section}>画面比例</Text>
      <View style={[styles.chips, styles.wrap]}>
        {SCALE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            testID={`player-settings-scale-${option.value}`}
            label={option.label}
            selected={option.value === scale}
            onPress={() => onSelectScale(option.value)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    backdrop: { flex: 1, backgroundColor: 'rgba(11,14,20,0.6)' },
    sheet: {
      position: 'absolute' as const,
      top: s(safeArea.vertical),
      bottom: s(safeArea.vertical),
      right: s(safeArea.horizontal),
      width: s(720),
      padding: s(space.lg),
      borderRadius: s(radii.button),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
      backgroundColor: 'rgba(21,26,36,0.96)',
    },
    title: { ...t.h2, marginBottom: s(space.md), color: color.text },
    body: { flex: 1, minHeight: 0 },
    close: { marginTop: s(space.md), alignSelf: 'flex-start' as const },
    // Room around focusable children so the focus zoom and ring are not clipped.
    bleed: { padding: s(focus.bleed) },
    flags: { flexGrow: 0, marginBottom: s(space.xs) },
    list: { flexGrow: 0 },
    chips: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm) },
    wrap: { flexWrap: 'wrap' as const },
    cell: { flex: 1 / EPISODE_COLUMNS, margin: s(space.xs), paddingHorizontal: s(space.sm) },
    option: { marginBottom: s(space.sm), justifyContent: 'flex-start' as const },
    section: { ...t.label, marginTop: s(space.sm), marginBottom: s(space.sm), color: color.text2 },
    note: { ...t.label, marginBottom: s(space.sm), color: color.text3 },
    form: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm), marginTop: s(space.xs) },
    input: {
      ...t.label,
      // Android clips single-line TextInput glyphs when a lineHeight is set.
      lineHeight: undefined,
      flex: 1,
      height: s(64),
      paddingHorizontal: s(space.md),
      paddingVertical: 0,
      borderRadius: s(radii.button),
      // A transparent border of the focus width keeps the text from shifting when focused.
      borderWidth: s(focus.borderWidth),
      borderColor: 'transparent',
      backgroundColor: color.surface2,
      color: color.text,
    },
    inputFocused: { borderColor: focus.borderColor },
  };
};
