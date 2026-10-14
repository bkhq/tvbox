import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import type { Live } from '../../core/types';
import { useMainNav } from '../../navigation/mainNav';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { Button, color, type Scaler, safeArea, scaledText, space, TopNav, useScaledStyles } from '../../ui';
import { LivePanel } from './LivePanel';

/** Longest technical detail shown under a status title. */
export const DETAIL_MAX = 120;

/** First line of an error message, cut to DETAIL_MAX characters; never the full exception chain. */
export function shortDetail(raw: string | undefined): string {
  const line = (raw ?? '').trim().split(/\r?\n/)[0]!.trim();
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

export type LiveStatusKind = 'loading' | 'error' | 'empty';

const TEST_IDS: Record<LiveStatusKind, string> = {
  loading: 'live-loading',
  error: 'live-load-error',
  empty: 'live-empty',
};

export interface LiveStatusProps {
  kind: LiveStatusKind;
  /** Human-readable first line, e.g. "频道加载失败"; loading shows "正在加载…". */
  title?: string;
  /** Technical detail, shortened with shortDetail. */
  detail?: string;
  lives?: Live[];
  /** Name of the selected live source. */
  home?: string;
  onRetry?(): void;
  onSelectLive?(live: Live): void;
}

/** Loading / error / empty page of the live screen: the main top bar over a centred status block. */
export function LiveStatus({ kind, title, detail, lives = [], home = '', onRetry, onSelectLive }: LiveStatusProps) {
  const navigation = useAppNavigation();
  const nav = useMainNav('live');
  const styles = useScaledStyles(makeStyles);
  const [picking, setPicking] = useState(false);
  const testID = TEST_IDS[kind];
  const technical = shortDetail(detail);

  return (
    <View style={styles.page} testID={testID}>
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
      <View style={styles.body}>
        {kind === 'loading' ? (
          <>
            <ActivityIndicator size="large" color={color.accent} />
            <Text style={styles.message}>正在加载…</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>{title}</Text>
            {technical ? (
              <Text style={styles.detail} numberOfLines={2} testID={`${testID}-detail`}>
                {technical}
              </Text>
            ) : null}
            <View style={styles.actions}>
              {onRetry ? (
                <Button testID={`${testID}-retry`} title="重试" size="md" onPress={onRetry} hasTVPreferredFocus />
              ) : null}
              {lives.length > 1 && onSelectLive ? (
                <Button
                  testID={`${testID}-switch`}
                  title="切换直播源"
                  icon="switch"
                  size="md"
                  onPress={() => setPicking(true)}
                />
              ) : null}
              <Button
                testID={`${testID}-settings`}
                title="直播设置"
                icon="settings"
                size="md"
                onPress={() => navigation.navigate('Settings')}
              />
            </View>
          </>
        )}
      </View>
      {picking && onSelectLive ? (
        <LivePanel
          lives={lives}
          home={home}
          onSelect={(next) => {
            setPicking(false);
            onSelectLive(next);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const { h2, body, caption } = scaledText(s);
  return {
    page: { flex: 1, backgroundColor: color.bg },
    body: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: s(safeArea.horizontal),
      paddingBottom: s(safeArea.vertical + 150),
    },
    title: { ...h2, color: color.text, textAlign: 'center' as const },
    message: { ...body, marginTop: s(space.md), color: color.text2, textAlign: 'center' as const },
    detail: { ...caption, marginTop: s(space.sm), maxWidth: s(1200), color: color.text3, textAlign: 'center' as const },
    actions: { flexDirection: 'row' as const, gap: s(space.md), marginTop: s(space.lg) },
  };
};
