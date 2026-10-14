import { type ReactNode, type Ref, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Text, View } from 'react-native';

import { getAppConfig } from '../../core/appConfig';
import { useVodConfig } from '../../core/bootstrap';
import { selectHome } from '../../core/config';
import { isServerLinkEnabled, SERVER_LINK_STATE_TEXT, useServerLink } from '../../core/serverLink';
import { type Settings, SPEED_PRESETS, useSetting } from '../../core/settings';
import type { ConfigKind } from '../../core/storage';
import { Button, color, scaledText, useScaledStyles, type Scaler } from '../../ui';
import { checkResultText, getUpdateController, useUpdateCheck } from '../../update';
import { unsupportedText } from '../home';
import { clearCache, formatBytes, getCacheSize } from './cache';
import { CONFIG_TITLE, ConfigPanel, useSavedConfigs } from './ConfigPanel';
import { useEntryRef } from './entryFocus';
import {
  type BooleanKey,
  type ChoiceKey,
  choiceOptions,
  formatSpeed,
  formatText,
  optionLabel,
  STEPS,
  type StepKey,
  type TextKey,
  vodStatusText,
} from './options';
import { OptionPanel, ServerLinkPanel, StepPanel, TextPanel } from './panels';
import { SegmentedSettingRow, SettingRow, ToggleSettingRow } from './SettingRow';

export type SettingsSectionId = 'collect' | 'history' | 'play' | 'subaudio' | 'live' | 'net' | 'sources' | 'about';

/** Sidebar entries of the 我的 page, in display order. */
export const settingsSections: readonly { id: SettingsSectionId; label: string; title: string; subtitle: string }[] = [
  { id: 'collect', label: '我的片单', title: '我的片单', subtitle: '收藏的影片' },
  { id: 'history', label: '观看历史', title: '观看历史', subtitle: '最近观看' },
  { id: 'play', label: '播放设置', title: '播放设置', subtitle: '对本设备生效' },
  { id: 'subaudio', label: '字幕与音频', title: '字幕与音频', subtitle: '字幕显示与音频输出' },
  { id: 'live', label: '直播设置', title: '直播设置', subtitle: '直播源与换台' },
  { id: 'net', label: '网络与缓存', title: '网络与缓存', subtitle: '本设备' },
  { id: 'sources', label: '配置与源', title: '配置与源', subtitle: '点播、直播与站点' },
  { id: 'about', label: '关于', title: '关于', subtitle: '星幕 TV' },
];

const SECTION = Object.fromEntries(settingsSections.map((section) => [section.id, section])) as Record<
  SettingsSectionId,
  (typeof settingsSections)[number]
>;

/** Short player engine names for the row value and the sidebar hint. */
const ENGINE_SHORT: Record<Settings['playerEngine'], string> = { auto: '自动', video: '系统', mpv: 'MPV' };

// --- Cache size, shared by the network section and the sidebar hint.

let cacheSize: number | undefined;
const cacheListeners = new Set<() => void>();

function subscribeCache(listener: () => void) {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
}

async function refreshCacheSize(): Promise<void> {
  try {
    cacheSize = await getCacheSize();
  } catch {
    cacheSize = undefined;
  }
  cacheListeners.forEach((listener) => listener());
}

/** Bytes under the cache directory (undefined until measured); measured on first use. */
export function useCacheSize(): { size: number | undefined; refresh: () => Promise<void> } {
  const size = useSyncExternalStore(subscribeCache, () => cacheSize);
  useEffect(() => {
    if (cacheSize === undefined) void refreshCacheSize();
  }, []);
  return { size, refresh: refreshCacheSize };
}

// --- Sidebar hints.

export interface SectionHintValues {
  playerEngine: Settings['playerEngine'];
  subtitleScale: number;
  cacheSize: number | undefined;
  versionName: string;
}

/** Short value shown beside a sidebar entry; empty when the section has none. */
export function sectionHint(id: SettingsSectionId, values: SectionHintValues): string {
  switch (id) {
    case 'play':
      return ENGINE_SHORT[values.playerEngine];
    case 'subaudio':
      return STEPS.subtitleScale.format(values.subtitleScale);
    case 'net':
      return values.cacheSize === undefined ? '' : formatBytes(values.cacheSize);
    case 'about':
      return `v${values.versionName}`;
    default:
      return '';
  }
}

export function useSectionHint(id: SettingsSectionId): string {
  const [playerEngine] = useSetting('playerEngine');
  const [subtitleScale] = useSetting('subtitleScale');
  const { size } = useCacheSize();
  return sectionHint(id, { playerEngine, subtitleScale, cacheSize: size, versionName: getAppConfig().versionName });
}

// --- Panels opened by the rows.

type PanelState =
  | { kind: 'config'; config: ConfigKind }
  | { kind: 'homeSite' }
  | { kind: 'speed' }
  | { kind: 'choice'; key: ChoiceKey; title: string }
  | { kind: 'step'; key: StepKey; title: string }
  | { kind: 'text'; key: TextKey; title: string; placeholder?: string }
  | { kind: 'serverLink' };

type OpenPanel = (panel: PanelState) => void;

function ChoicePanel<K extends ChoiceKey>({
  settingKey,
  title,
  onClose,
}: {
  settingKey: K;
  title: string;
  onClose: () => void;
}) {
  const [value, setValue] = useSetting(settingKey);
  return (
    <OptionPanel
      title={title}
      testIDPrefix={`settings-${settingKey}`}
      options={choiceOptions(settingKey)}
      value={value}
      onSelect={(next) => {
        void setValue(next);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

function HomeSitePanel({ onClose }: { onClose: () => void }) {
  const { config } = useVodConfig();
  const [homeSiteKey, setHomeSiteKey] = useSetting('homeSiteKey');
  const sites = config?.sites ?? [];
  const home = selectHome(sites, homeSiteKey || config?.home?.key);
  return (
    <OptionPanel
      title="首页站点"
      testIDPrefix="settings-site"
      options={sites.map((site) => ({
        value: site.key,
        label: site.name || site.key,
        disabled: !site.supported,
        note: site.supported ? undefined : unsupportedText(site),
      }))}
      value={home?.key}
      onSelect={(key) => void setHomeSiteKey(key)}
      onClose={onClose}
    />
  );
}

function SpeedPanel({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useSetting('speedPlayback');
  return (
    <OptionPanel
      title="播放速度"
      testIDPrefix="settings-speed"
      options={SPEED_PRESETS.map((speed) => ({ value: speed, label: formatSpeed(speed) }))}
      value={value}
      onSelect={(speed) => {
        void setValue(speed);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

function PanelView({ panel, onClose }: { panel: PanelState; onClose: () => void }) {
  switch (panel.kind) {
    case 'config':
      return <ConfigPanel kind={panel.config} onClose={onClose} />;
    case 'homeSite':
      return <HomeSitePanel onClose={onClose} />;
    case 'speed':
      return <SpeedPanel onClose={onClose} />;
    case 'choice':
      return <ChoicePanel settingKey={panel.key} title={panel.title} onClose={onClose} />;
    case 'step':
      return <StepPanel settingKey={panel.key} title={panel.title} onClose={onClose} />;
    case 'text':
      return <TextPanel settingKey={panel.key} title={panel.title} placeholder={panel.placeholder} onClose={onClose} />;
    case 'serverLink':
      return <ServerLinkPanel onClose={onClose} />;
  }
}

// --- Rows.

interface RowProps {
  title: string;
  hasTVPreferredFocus?: boolean;
  /** Set on the first row of a section: the 我的 panel entry. */
  ref?: Ref<View>;
}

function ToggleRow({ settingKey, ...row }: RowProps & { settingKey: BooleanKey }) {
  const [value, setValue] = useSetting(settingKey);
  return (
    <ToggleSettingRow {...row} testID={`settings-${settingKey}`} value={value} onPress={() => void setValue(!value)} />
  );
}

function SegmentRow<K extends ChoiceKey>({ settingKey, ...row }: RowProps & { settingKey: K }) {
  const [value, setValue] = useSetting(settingKey);
  return (
    <SegmentedSettingRow
      {...row}
      testID={`settings-${settingKey}`}
      options={choiceOptions(settingKey)}
      value={value}
      onChange={(next) => void setValue(next)}
    />
  );
}

function PickerRow<K extends ChoiceKey>({
  settingKey,
  title,
  format,
  open,
  hasTVPreferredFocus,
  ref,
}: RowProps & { settingKey: K; format?: (value: Settings[K]) => string; open: OpenPanel }) {
  const [value] = useSetting(settingKey);
  return (
    <SettingRow
      ref={ref}
      testID={`settings-${settingKey}`}
      title={title}
      value={format ? format(value) : optionLabel(choiceOptions(settingKey), value)}
      chevron
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => open({ kind: 'choice', key: settingKey, title })}
    />
  );
}

function StepRow({
  settingKey,
  title,
  open,
  hasTVPreferredFocus,
  ref,
}: RowProps & { settingKey: StepKey; open: OpenPanel }) {
  const [value] = useSetting(settingKey);
  return (
    <SettingRow
      ref={ref}
      testID={`settings-${settingKey}`}
      title={title}
      value={STEPS[settingKey].format(value)}
      chevron
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => open({ kind: 'step', key: settingKey, title })}
    />
  );
}

function TextRow({
  settingKey,
  title,
  placeholder,
  open,
  hasTVPreferredFocus,
  ref,
}: RowProps & { settingKey: TextKey; placeholder?: string; open: OpenPanel }) {
  const [value] = useSetting(settingKey);
  return (
    <SettingRow
      ref={ref}
      testID={`settings-${settingKey}`}
      title={title}
      value={formatText(value)}
      chevron
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => open({ kind: 'text', key: settingKey, title, placeholder })}
    />
  );
}

function SpeedRow({ open }: { open: OpenPanel }) {
  const [value] = useSetting('speedPlayback');
  return (
    <SettingRow
      testID="settings-speedPlayback"
      title="播放速度"
      value={formatSpeed(value)}
      chevron
      onPress={() => open({ kind: 'speed' })}
    />
  );
}

function VodConfigRow({
  open,
  hasTVPreferredFocus,
  ref,
}: {
  open: OpenPanel;
  hasTVPreferredFocus?: boolean;
  ref?: Ref<View>;
}) {
  const vod = useVodConfig();
  return (
    <SettingRow
      ref={ref}
      testID="settings-vod"
      title={CONFIG_TITLE.vod}
      value={vodStatusText(vod)}
      chevron
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => open({ kind: 'config', config: 'vod' })}
    />
  );
}

function LiveConfigRow({
  open,
  refreshKey,
  hasTVPreferredFocus,
  ref,
}: {
  open: OpenPanel;
  refreshKey: unknown;
  hasTVPreferredFocus?: boolean;
  ref?: Ref<View>;
}) {
  const [{ active }] = useSavedConfigs('live', refreshKey);
  return (
    <SettingRow
      ref={ref}
      testID="settings-live"
      title={CONFIG_TITLE.live}
      value={active ? active.name || active.url : '未设置'}
      chevron
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={() => open({ kind: 'config', config: 'live' })}
    />
  );
}

function HomeSiteRow({ open }: { open: OpenPanel }) {
  const { config } = useVodConfig();
  const [homeSiteKey] = useSetting('homeSiteKey');
  const home = config && selectHome(config.sites, homeSiteKey || config.home?.key);
  return (
    <SettingRow
      testID="settings-homeSite"
      title="首页站点"
      value={home ? home.name || home.key : '未加载配置'}
      chevron
      onPress={() => open({ kind: 'homeSite' })}
    />
  );
}

function ServerLinkRow({ open }: { open: OpenPanel }) {
  const { state } = useServerLink();
  return (
    <SettingRow
      testID="settings-serverLink"
      title="服务器绑定"
      value={SERVER_LINK_STATE_TEXT[state]}
      chevron
      onPress={() => open({ kind: 'serverLink' })}
    />
  );
}

function CacheRow({ hasTVPreferredFocus }: { hasTVPreferredFocus?: boolean }) {
  const { size, refresh } = useCacheSize();
  const [cleared, setCleared] = useState(false);
  // The cache grows while browsing; measure again whenever the row is shown.
  useEffect(() => void refresh(), [refresh]);
  const clear = async () => {
    await clearCache().then(
      () => setCleared(true),
      () => undefined,
    );
    await refresh();
  };
  return (
    <SettingRow
      testID="settings-cache"
      title="缓存"
      note={size === undefined ? '正在计算…' : `已占用 ${formatBytes(size)}`}
      accessory={
        <Button
          testID="settings-cache-clear"
          title={cleared ? '已清理' : '清理缓存'}
          size="md"
          hasTVPreferredFocus={hasTVPreferredFocus}
          onPress={() => void clear()}
        />
      }
    />
  );
}

// --- Sections.

interface SectionProps {
  hasTVPreferredFocus?: boolean;
}

function SettingsSection({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  const styles = useScaledStyles(makeStyles);
  const { title, subtitle } = SECTION[id];
  return (
    <View testID={`settings-section-${id}`} style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

/** Section that opens editor panels; the first row keeps the preferred focus while no panel is open. */
function usePanel(): [PanelState | undefined, OpenPanel, ReactNode] {
  const [panel, setPanel] = useState<PanelState>();
  const view = panel ? <PanelView panel={panel} onClose={() => setPanel(undefined)} /> : null;
  return [panel, setPanel, view];
}

export function PlaybackSection({ hasTVPreferredFocus }: SectionProps) {
  const [panel, open, panelView] = usePanel();
  const entry = useEntryRef();
  return (
    <SettingsSection id="play">
      <PickerRow
        ref={entry}
        settingKey="playerEngine"
        title="播放引擎"
        format={(value) => ENGINE_SHORT[value]}
        open={open}
        hasTVPreferredFocus={hasTVPreferredFocus && !panel}
      />
      <SegmentRow settingKey="decode" title="解码方式" />
      <SegmentRow settingKey="render" title="渲染方式" />
      <PickerRow settingKey="scale" title="缩放比例" open={open} />
      <StepRow settingKey="buffer" title="缓冲时间" open={open} />
      <ToggleRow settingKey="background" title="后台播放" />
      <SpeedRow open={open} />
      <StepRow settingKey="speedLongPress" title="长按倍速" open={open} />
      <ToggleRow settingKey="speedSkipSilence" title="跳过无声片段" />
      <ToggleRow settingKey="videoPrefer" title="视频软解" />
      <ToggleRow settingKey="tunnel" title="隧道模式" />
      <ToggleRow settingKey="adblock" title="智能去广" />
      <ToggleRow settingKey="incognito" title="无痕模式" />
      {panelView}
    </SettingsSection>
  );
}

export function SubtitleAudioSection({ hasTVPreferredFocus }: SectionProps) {
  const [panel, open, panelView] = usePanel();
  const entry = useEntryRef();
  return (
    <SettingsSection id="subaudio">
      <SegmentRow
        ref={entry}
        settingKey="subtitleStyleSource"
        title="样式来源"
        hasTVPreferredFocus={hasTVPreferredFocus && !panel}
      />
      <StepRow settingKey="subtitleScale" title="字幕大小" open={open} />
      <StepRow settingKey="subtitlePosition" title="字幕位置" open={open} />
      <ToggleRow settingKey="audioPassThrough" title="音频直通" />
      <ToggleRow settingKey="audioPrefer" title="音频软解" />
      <ToggleRow settingKey="preferAac" title="AAC优先" />
      {panelView}
    </SettingsSection>
  );
}

export function LiveSection({ hasTVPreferredFocus }: SectionProps) {
  const [panel, open, panelView] = usePanel();
  const entry = useEntryRef();
  return (
    <SettingsSection id="live">
      <LiveConfigRow ref={entry} open={open} refreshKey={panel} hasTVPreferredFocus={hasTVPreferredFocus && !panel} />
      <ToggleRow settingKey="across" title="跨分类换台" />
      <ToggleRow settingKey="change" title="失败自动换源" />
      <ToggleRow settingKey="invert" title="换台反转" />
      <PickerRow settingKey="scaleLive" title="缩放比例" open={open} />
      {panelView}
    </SettingsSection>
  );
}

export function NetworkSection({ hasTVPreferredFocus }: SectionProps) {
  const [panel, open, panelView] = usePanel();
  const showAirplay = Platform.OS === 'android' && Platform.isTV;
  const entry = useEntryRef();
  return (
    <SettingsSection id="net">
      <TextRow
        ref={entry}
        settingKey="doh"
        title="DoH"
        placeholder="DoH 地址，留空不使用"
        open={open}
        hasTVPreferredFocus={hasTVPreferredFocus && !panel}
      />
      <TextRow settingKey="ua" title="User-Agent" open={open} />
      {showAirplay ? (
        <>
          <ToggleRow settingKey="airplay" title="AirPlay" />
          <TextRow settingKey="airplayName" title="AirPlay 名称" placeholder="留空使用 tvbox" open={open} />
        </>
      ) : null}
      <CacheRow />
      {panelView}
    </SettingsSection>
  );
}

export function SourcesSection({ hasTVPreferredFocus }: SectionProps) {
  const [panel, open, panelView] = usePanel();
  const entry = useEntryRef();
  return (
    <SettingsSection id="sources">
      <VodConfigRow ref={entry} open={open} hasTVPreferredFocus={hasTVPreferredFocus && !panel} />
      <HomeSiteRow open={open} />
      <SegmentRow settingKey="siteMode" title="站点显示" />
      {isServerLinkEnabled() ? <ServerLinkRow open={open} /> : null}
      {panelView}
    </SettingsSection>
  );
}

export function AboutSection({ hasTVPreferredFocus }: SectionProps) {
  const { versionName, versionCode } = getAppConfig();
  const { checking, lastResult, check } = useUpdateCheck(getUpdateController());
  const entry = useEntryRef();
  const styles = useScaledStyles(makeStyles);
  return (
    <SettingsSection id="about">
      <SettingRow
        ref={entry}
        testID="settings-version"
        title="版本"
        value={`${versionName} (${versionCode})`}
        note={lastResult && !checking ? checkResultText(lastResult) : undefined}
        noteTestID="update-result"
        accessory={
          <Button
            testID="update-check"
            title={checking ? '正在检查…' : '检查更新'}
            size="md"
            disabled={checking}
            hasTVPreferredFocus={hasTVPreferredFocus}
            style={styles.aboutAction}
            onPress={() => void check(true)}
          />
        }
      />
    </SettingsSection>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    section: { gap: s(28) },
    header: { gap: s(8) },
    title: { ...text.h1, color: color.text },
    subtitle: { ...text.caption, fontSize: s(22), lineHeight: s(30), color: color.text3 },
    rows: { gap: s(12) },
    // With the row gap, keeps 24 between the version and the focused button (1.08 zoom plus ring).
    aboutAction: { marginLeft: s(24) },
  };
};
