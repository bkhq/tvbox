import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { asyncStorageStore, type ConfigKind, type ConfigRepository, createConfigRepository, type SavedConfig } from '../../core/storage';
import { colors, FocusableButton, fontSize, radius, spacing } from '../../ui';
import { FocusableInput } from '../common';
import { vodStatusText } from './options';
import { Panel } from './Panel';
import { SettingRow } from './SettingRow';

/** Saved VOD and live configs; the bootstrap reads the same VOD repository. */
export const configRepositories: Record<ConfigKind, ConfigRepository> = {
  vod: createConfigRepository(asyncStorageStore, 'vod'),
  live: createConfigRepository(asyncStorageStore, 'live'),
};

export const CONFIG_TITLE: Record<ConfigKind, string> = {
  vod: '点播配置',
  live: '直播配置',
};

interface ConfigList {
  items: SavedConfig[];
  active?: SavedConfig;
}

async function readList(kind: ConfigKind): Promise<ConfigList> {
  const repository = configRepositories[kind];
  const [items, active] = await Promise.all([repository.list(), repository.getActive()]);
  return { items, active };
}

/** Saved configs of `kind` with the active one; reloads whenever `refreshKey` changes. */
export function useSavedConfigs(kind: ConfigKind, refreshKey?: unknown): [ConfigList, () => Promise<void>] {
  const [list, setList] = useState<ConfigList>({ items: [] });
  useEffect(() => {
    let current = true;
    void readList(kind).then((next) => {
      if (current) setList(next);
    });
    return () => {
      current = false;
    };
  }, [kind, refreshKey]);
  const refresh = useCallback(async () => setList(await readList(kind)), [kind]);
  return [list, refresh];
}

export function ConfigPanel({ kind, onClose }: { kind: ConfigKind; onClose: () => void }) {
  const vod = useVodConfig();
  const repository = configRepositories[kind];
  // The bootstrap bumps the VOD entry after every load, so follow its snapshot.
  const [{ items, active }, refresh] = useSavedConfigs(kind, kind === 'vod' ? vod.entry : undefined);
  const [url, setUrl] = useState('');

  const select = async (entry: SavedConfig) => {
    await repository.setActive(entry.url);
    if (kind === 'vod') await vod.reload();
    await refresh();
  };
  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setUrl('');
    if (kind === 'vod') {
      await vod.addConfig(trimmed);
    } else {
      await repository.add({ url: trimmed });
      await repository.setActive(trimmed);
    }
    await refresh();
  };
  const remove = async (entry: SavedConfig) => {
    await repository.remove(entry.url);
    if (kind === 'vod' && entry.url === active?.url) await vod.reload();
    await refresh();
  };

  const preferred = active ?? items[0];
  return (
    <Panel title={CONFIG_TITLE[kind]} onClose={onClose}>
      {kind === 'vod' ? <Text style={styles.status}>{`状态：${vodStatusText(vod)}`}</Text> : null}
      {items.map((entry) => (
        <View key={entry.url} style={styles.item}>
          <View style={styles.itemRow}>
            <SettingRow
              testID={`settings-config-${entry.url}`}
              title={entry.name || entry.url}
              note={entry.name ? entry.url : undefined}
              selected={entry.url === active?.url}
              hasTVPreferredFocus={entry.url === preferred?.url}
              onPress={() => void select(entry)}
            />
          </View>
          <FocusableButton testID={`settings-config-remove-${entry.url}`} title="删除" onPress={() => void remove(entry)} />
        </View>
      ))}
      {items.length === 0 ? <Text style={styles.status}>尚未添加配置</Text> : null}
      <View style={styles.form}>
        <FocusableInput
          testID="settings-config-input"
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          onSubmitEditing={() => void add()}
          placeholder="输入配置地址"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hasTVPreferredFocus={!preferred}
        />
        <FocusableButton testID="settings-config-add" title="添加" disabled={!url.trim()} onPress={() => void add()} />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  status: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemRow: {
    flex: 1,
  },
  form: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
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
