import { type ReactNode, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TVFocusGuideView, View } from 'react-native';

import { SPEED_PRESETS } from '../../core/settings/schema';
import type { Flag } from '../../core/types';
import type { EnginePreference } from '../../player/engine/policy';
import type { EngineFactory, ExternalSubtitle, Track, TrackId } from '../../player/engine/types';
import {
  Button,
  Chip,
  color,
  focus,
  OptionRow,
  radii,
  safeArea,
  type Scaler,
  scaledText,
  space,
  useScale,
  useScaledStyles,
} from '../../ui';
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

const SHEET_WIDTH = 720;
/** Height of a md Button. */
const CELL_HEIGHT = 64;
/**
 * Fixed cell width, so a partial last row keeps the width of the full rows; one px short of the sheet width so
 * pixel rounding never wraps a full row early.
 */
const CELL_WIDTH = (SHEET_WIDTH - 2 * space.lg - (EPISODE_COLUMNS - 1) * space.sm) / EPISODE_COLUMNS - 1;
/** A focused full-width row grows by half the zoom of its width on each side, then draws its ring outside that. */
const ROW_BLEED = Math.ceil(((focus.scale - 1) / 2) * (SHEET_WIDTH - 2 * space.lg) + focus.ringGap + focus.ringWidth);

/**
 * Right-side modal sheet. The hardware back key (Android) and the Menu button
 * (tvOS) call onRequestClose, so back closes the panel before leaving the player.
 * The sheet traps D-pad focus on every side so it never escapes the modal.
 */
export function Panel({ kind, onClose, children }: { kind: PanelKind; onClose: () => void; children: ReactNode }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID={`player-panel-${kind}`} style={styles.sheet}>
          <TVFocusGuideView style={styles.trap} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
            <Text style={styles.title}>{TITLES[kind]}</Text>
            <View style={styles.body}>{children}</View>
            <Button testID="player-panel-close" size="md" title="关闭" style={styles.close} onPress={onClose} />
          </TVFocusGuideView>
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
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const [shownFlag, setShownFlag] = useState(flagIndex);
  const list = useRef<ScrollView>(null);
  // The current episode's row is scrolled into view once, when the grid first lays out.
  const scrolled = useRef(false);
  const episodes = flags[shownFlag]?.episodes ?? [];
  return (
    <>
      {flags.length > 1 ? (
        <ScrollView horizontal style={styles.flags} contentContainerStyle={[styles.chips, styles.bleed]}>
          {flags.map((flag, index) => (
            <Chip
              key={`${index}-${flag.flag}`}
              variant="accent"
              testID={`player-flag-${index}`}
              label={flag.flag}
              selected={index === shownFlag}
              onPress={() => setShownFlag(index)}
            />
          ))}
        </ScrollView>
      ) : null}
      {/* A wrapped grid in a ScrollView: unlike a FlatList grid it keeps D-pad focus on a cell at every edge. */}
      <ScrollView
        key={shownFlag}
        ref={list}
        style={styles.list}
        contentContainerStyle={[styles.chips, styles.wrap, styles.bleed]}
        onContentSizeChange={() => {
          if (scrolled.current || shownFlag !== flagIndex) return;
          scrolled.current = true;
          const row = Math.floor(episodeIndex / EPISODE_COLUMNS);
          list.current?.scrollTo({ y: row * s(CELL_HEIGHT + space.sm), animated: false });
        }}
      >
        {episodes.map((item, index) => {
          const current = shownFlag === flagIndex && index === episodeIndex;
          return (
            <Button
              key={`${index}-${item.url}`}
              testID={`player-episode-${index}`}
              size="md"
              variant={current ? 'primary' : 'secondary'}
              style={styles.cell}
              title={item.name}
              hasTVPreferredFocus={current}
              onPress={() => onSelect(index, shownFlag)}
            />
          );
        })}
      </ScrollView>
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
        <OptionRow
          key={`${index}-${flag.flag}`}
          style={styles.option}
          testID={`player-line-${index}`}
          label={flag.flag}
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
    <View style={[styles.chips, styles.wrap, styles.bleed, styles.outdent]}>
      {SPEED_PRESETS.map((value) => (
        <Chip
          key={value}
          variant="accent"
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
        <OptionRow
          key={String(track.id)}
          style={styles.option}
          testID={`player-audio-${track.id}`}
          label={trackLabel(track) ?? `音轨 ${index + 1}`}
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
  // Like the 音轨 panel: the selected track is current, and 关闭 when subtitles are off or no track is selected.
  const current = selected === null ? undefined : tracks.find((track) => isSelected(track, selected));
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.bleed}>
      <OptionRow
        style={styles.option}
        testID="player-subtitle-off"
        label="关闭"
        selected={!current}
        hasTVPreferredFocus={!current}
        onPress={() => onSelect(null)}
      />
      {tracks.map((track, index) => (
        <OptionRow
          key={String(track.id)}
          style={styles.option}
          testID={`player-subtitle-${track.id}`}
          label={trackLabel(track) ?? `字幕 ${index + 1}`}
          selected={track === current}
          hasTVPreferredFocus={track === current}
          onPress={() => onSelect(track.id)}
        />
      ))}
      {shownExternal.map((subtitle) => (
        <OptionRow
          key={subtitle.url}
          style={styles.option}
          testID={`player-subtitle-external-${subtitle.name}`}
          label={`外挂：${subtitle.name}`}
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
      <OptionRow
        style={styles.option}
        testID={`${prefix}-auto`}
        label="自动"
        selected={preference === 'auto'}
        hasTVPreferredFocus={preference === 'auto'}
        onPress={() => onSelect('auto')}
      />
      {engines.map((engine) => (
        <OptionRow
          key={engine.kind}
          style={styles.option}
          testID={`${prefix}-${engine.kind}`}
          label={engine.label}
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
    <View style={[styles.bleed, styles.outdent]}>
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
      <TVFocusGuideView autoFocus>
        <EngineOptions
          engines={engines}
          preference={preference}
          active={active}
          onSelect={onSelectEngine}
          prefix="player-settings-engine"
        />
      </TVFocusGuideView>
      <Text style={styles.section}>画面比例</Text>
      {/* Entering a section from the other one lands on its first (or last focused) control, not the nearest. */}
      <TVFocusGuideView autoFocus style={[styles.chips, styles.wrap]}>
        {SCALE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            variant="accent"
            testID={`player-settings-scale-${option.value}`}
            label={option.label}
            selected={option.value === scale}
            onPress={() => onSelectScale(option.value)}
          />
        ))}
      </TVFocusGuideView>
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
      width: s(SHEET_WIDTH),
      padding: s(space.lg),
      borderRadius: s(radii.button),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
      backgroundColor: 'rgba(21,26,36,0.96)',
    },
    title: { ...t.h2, marginBottom: s(space.md), color: color.text },
    trap: { flex: 1 },
    body: { flex: 1, minHeight: 0 },
    close: { marginTop: s(space.md), alignSelf: 'flex-start' as const },
    // Room around focusable children so the focus zoom and ring are not clipped; outdent keeps the rows aligned
    // with the title.
    bleed: { paddingVertical: s(focus.bleed), paddingHorizontal: s(ROW_BLEED) },
    outdent: { marginHorizontal: -s(ROW_BLEED) },
    flags: { flexGrow: 0, marginHorizontal: -s(ROW_BLEED), marginBottom: s(space.xs) },
    list: { flexGrow: 0, marginHorizontal: -s(ROW_BLEED) },
    chips: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm) },
    wrap: { flexWrap: 'wrap' as const },
    cell: { width: s(CELL_WIDTH), paddingHorizontal: s(space.sm) },
    option: { marginBottom: s(space.sm) },
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
