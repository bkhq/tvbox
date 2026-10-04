import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getAppConfig } from '../../core/appConfig';
import { useVodConfig } from '../../core/bootstrap';
import { selectHome } from '../../core/config';
import { isServerLinkEnabled, SERVER_LINK_STATE_TEXT, useServerLink } from '../../core/serverLink';
import { SPEED_PRESETS, useSetting } from '../../core/settings';
import type { ConfigKind } from '../../core/storage';
import { colors, fontSize, spacing, useLayout } from '../../ui';
import { unsupportedText } from '../home';
import { CONFIG_TITLE, ConfigPanel, useSavedConfigs } from './ConfigPanel';
import {
  type BooleanKey,
  type ChoiceKey,
  choiceOptions,
  cycleOption,
  formatBoolean,
  formatSpeed,
  formatText,
  optionLabel,
  STEPS,
  type StepKey,
  type TextKey,
  vodStatusText,
} from './options';
import { OptionPanel, ServerLinkPanel, StepPanel, TextPanel } from './panels';
import { Section, SettingRow } from './SettingRow';

type PanelState =
  | { kind: 'config'; config: ConfigKind }
  | { kind: 'homeSite' }
  | { kind: 'speed' }
  | { kind: 'step'; key: StepKey; title: string }
  | { kind: 'text'; key: TextKey; title: string; placeholder?: string }
  | { kind: 'serverLink' };

type OpenPanel = (panel: PanelState) => void;

function ToggleRow({ settingKey, title }: { settingKey: BooleanKey; title: string }) {
  const [value, setValue] = useSetting(settingKey);
  return (
    <SettingRow testID={`settings-${settingKey}`} title={title} value={formatBoolean(value)} onPress={() => void setValue(!value)} />
  );
}

function ChoiceRow<K extends ChoiceKey>({ settingKey, title }: { settingKey: K; title: string }) {
  const [value, setValue] = useSetting(settingKey);
  const options = choiceOptions(settingKey);
  return (
    <SettingRow
      testID={`settings-${settingKey}`}
      title={title}
      value={optionLabel(options, value)}
      onPress={() => void setValue(cycleOption(options, value))}
    />
  );
}

function StepRow({ settingKey, title, open }: { settingKey: StepKey; title: string; open: OpenPanel }) {
  const [value] = useSetting(settingKey);
  return (
    <SettingRow
      testID={`settings-${settingKey}`}
      title={title}
      value={STEPS[settingKey].format(value)}
      onPress={() => open({ kind: 'step', key: settingKey, title })}
    />
  );
}

function TextRow({ settingKey, title, placeholder, open }: { settingKey: TextKey; title: string; placeholder?: string; open: OpenPanel }) {
  const [value] = useSetting(settingKey);
  return (
    <SettingRow
      testID={`settings-${settingKey}`}
      title={title}
      value={formatText(value)}
      onPress={() => open({ kind: 'text', key: settingKey, title, placeholder })}
    />
  );
}

function LiveConfigRow({ open, refreshKey }: { open: OpenPanel; refreshKey: unknown }) {
  const [{ active }] = useSavedConfigs('live', refreshKey);
  return (
    <SettingRow
      testID="settings-live"
      title={CONFIG_TITLE.live}
      value={active ? active.name || active.url : '未设置'}
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
      onPress={() => open({ kind: 'homeSite' })}
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

function SpeedRow({ open }: { open: OpenPanel }) {
  const [value] = useSetting('speedPlayback');
  return <SettingRow testID="settings-speedPlayback" title="播放速度" value={formatSpeed(value)} onPress={() => open({ kind: 'speed' })} />;
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

function ServerLinkRow({ open }: { open: OpenPanel }) {
  const { state } = useServerLink();
  return (
    <SettingRow
      testID="settings-serverLink"
      title="服务器绑定"
      value={SERVER_LINK_STATE_TEXT[state]}
      onPress={() => open({ kind: 'serverLink' })}
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
    case 'step':
      return <StepPanel settingKey={panel.key} title={panel.title} onClose={onClose} />;
    case 'text':
      return <TextPanel settingKey={panel.key} title={panel.title} placeholder={panel.placeholder} onClose={onClose} />;
    case 'serverLink':
      return <ServerLinkPanel onClose={onClose} />;
  }
}

export default function SettingsScreen() {
  const vod = useVodConfig();
  const { isTV } = useLayout();
  const [panel, setPanel] = useState<PanelState>();
  const { versionName, versionCode } = getAppConfig();
  const showAirplay = Platform.OS === 'android' && Platform.isTV;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.list, isTV && styles.listTV]}>
        <Text style={styles.title}>设置</Text>
        <Section title="配置">
          <SettingRow
            testID="settings-vod"
            title={CONFIG_TITLE.vod}
            value={vodStatusText(vod)}
            hasTVPreferredFocus={!panel}
            onPress={() => setPanel({ kind: 'config', config: 'vod' })}
          />
          <LiveConfigRow open={setPanel} refreshKey={panel} />
          <HomeSiteRow open={setPanel} />
        </Section>
        {isServerLinkEnabled() ? (
          <Section title="服务器">
            <ServerLinkRow open={setPanel} />
          </Section>
        ) : null}
        <Section title="播放">
          <ChoiceRow settingKey="playerEngine" title="播放引擎" />
          <ChoiceRow settingKey="decode" title="解码方式" />
          <ChoiceRow settingKey="render" title="渲染方式" />
          <ChoiceRow settingKey="scale" title="缩放比例" />
          <StepRow settingKey="buffer" title="缓冲时间" open={setPanel} />
          <ToggleRow settingKey="background" title="后台播放" />
          <SpeedRow open={setPanel} />
          <StepRow settingKey="speedLongPress" title="长按倍速" open={setPanel} />
          <ToggleRow settingKey="speedSkipSilence" title="跳过无声片段" />
        </Section>
        <Section title="解码设置">
          <ToggleRow settingKey="audioPassThrough" title="音频直通" />
          <ToggleRow settingKey="audioPrefer" title="音频软解" />
          <ToggleRow settingKey="videoPrefer" title="视频软解" />
          <ToggleRow settingKey="preferAac" title="AAC优先" />
          <ToggleRow settingKey="tunnel" title="隧道模式" />
        </Section>
        <Section title="字幕">
          <ChoiceRow settingKey="subtitleStyleSource" title="样式来源" />
          <StepRow settingKey="subtitleScale" title="字幕大小" open={setPanel} />
          <StepRow settingKey="subtitlePosition" title="字幕位置" open={setPanel} />
        </Section>
        <Section title="网络与其他">
          <TextRow settingKey="doh" title="DoH" placeholder="DoH 地址，留空不使用" open={setPanel} />
          <TextRow settingKey="ua" title="User-Agent" open={setPanel} />
          <ToggleRow settingKey="incognito" title="无痕模式" />
          <ToggleRow settingKey="adblock" title="智能去广" />
          <ChoiceRow settingKey="siteMode" title="站点显示" />
        </Section>
        {showAirplay ? (
          <Section title="AirPlay">
            <ToggleRow settingKey="airplay" title="AirPlay" />
            <TextRow settingKey="airplayName" title="AirPlay 名称" placeholder="留空使用 tvbox" open={setPanel} />
          </Section>
        ) : null}
        <Section title="关于">
          <SettingRow testID="settings-version" title="版本" value={`${versionName} (${versionCode})`} />
        </Section>
      </ScrollView>
      {panel ? <PanelView panel={panel} onClose={() => setPanel(undefined)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: spacing.lg,
  },
  listTV: {
    paddingHorizontal: '15%',
    paddingVertical: spacing.xl,
  },
  title: {
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: fontSize.display,
  },
});
