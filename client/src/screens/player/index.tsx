import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useSetting } from '../../core/settings/useSetting';
import type { RootStackScreenProps } from '../../navigation/types';
import { getEngine, listEngines } from '../../player/engine/registry';
import type { PlayerParams } from '../../player/params';
import { usePlayback } from '../../player/usePlayback';
import { isPlaying, selectEpisode, selectHasNext, selectHasPrev } from '../../player/machine';
import { colors, fontSize, radius, spacing, useLayout } from '../../ui';
import { ErrorView } from '../common';
import { Controls } from './Controls';
import { formatTime } from './format';
import { AudioPanel, EnginePanel, EpisodePanel, Panel, type PanelKind, SpeedPanel, SubtitlePanel } from './Panels';
import { useBackgroundPause } from './useBackgroundPause';
import { useRemoteKeys } from './useRemoteKeys';
import { useTouchGestures } from './useTouchGestures';

/** The controls hide after this long without input. */
export const CONTROLS_HIDE_DELAY = 5_000;
/** Toast duration. */
export const NOTICE_DURATION = 3_000;

const STATUS_TEXT: Partial<Record<string, string>> = {
  idle: '正在加载…',
  resolving: '正在获取播放信息…',
  parsing: '正在解析播放地址…',
  loading: '正在加载…',
  buffering: '缓冲中…',
};

export function fallbackNotice(label: string): string {
  return `已切换到 ${label} 播放`;
}

interface PlayerViewProps {
  params: PlayerParams;
  focused: boolean;
  onExit(): void;
  onReload(): void;
}

function PlayerView({ params, focused, onExit, onReload }: PlayerViewProps) {
  const { isTV } = useLayout();
  const { width } = useWindowDimensions();
  const [background] = useSetting('background');
  const [enginePreference] = useSetting('playerEngine');
  const playback = usePlayback(params, { attach: focused });
  const {
    state,
    source,
    sourceKey,
    engine,
    resizeMode,
    setEngineHandle,
    onEngineEvent,
    play,
    pause,
    toggle,
    seek,
    next,
    prev,
    selectEpisode: playEpisode,
    setSpeed,
    selectTrack,
    addSubtitle,
    switchEngine,
  } = playback;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const [overlay, setOverlay] = useState(false);
  const [panel, setPanel] = useState<PanelKind | undefined>(undefined);
  const [activity, setActivity] = useState(0);
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ text: string; id: number } | undefined>(undefined);

  const bump = useCallback(() => setActivity((n) => n + 1), []);
  const showNotice = (text: string) => setNotice((current) => ({ text, id: (current?.id ?? 0) + 1 }));

  // Toasts for an engine fallback and the machine's transient notices (state adjusted during render).
  const fallbackKey = state.fallbackUsed && state.engine ? `${state.token}:${state.engine}` : '';
  const [seenFallback, setSeenFallback] = useState('');
  if (fallbackKey !== seenFallback) {
    setSeenFallback(fallbackKey);
    if (fallbackKey && state.engine) showNotice(fallbackNotice(getEngine(state.engine)?.label ?? state.engine));
  }
  const machineNotice = state.notice ?? '';
  const [seenNotice, setSeenNotice] = useState('');
  if (machineNotice !== seenNotice) {
    setSeenNotice(machineNotice);
    if (machineNotice) showNotice(machineNotice);
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_DURATION);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!overlay || panel) return;
    const timer = setTimeout(() => setOverlay(false), CONTROLS_HIDE_DELAY);
    return () => clearTimeout(timer);
  }, [overlay, panel, activity]);

  useBackgroundPause(background, pause);

  // Back closes the controls first; panels close through their modal.
  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!overlay) return false;
      setOverlay(false);
      return true;
    });
    return () => subscription.remove();
  }, [focused, overlay]);

  const showControls = useCallback(() => {
    setOverlay(true);
    bump();
  }, [bump]);
  const openPanel = useCallback(
    (kind: PanelKind) => {
      setOverlay(true);
      setPanel(kind);
    },
    [],
  );
  const closePanel = useCallback(() => {
    setPanel(undefined);
    bump();
  }, [bump]);

  const seekPreview = (offset: number) => {
    const { position, duration } = stateRef.current;
    const target = Math.max(0, position + offset);
    setSeekTarget(duration > 0 ? Math.min(duration, target) : target);
  };
  const seekCommit = (offset: number) => {
    setSeekTarget(undefined);
    const { position, duration, source: current } = stateRef.current;
    if (!current || offset === 0) return;
    const target = Math.max(0, position + offset);
    seek(duration > 0 ? Math.min(duration, target) : target);
  };
  // VideoActivity.onKeyCenter: pause / resume and hide the controls.
  const center = () => {
    toggle();
    setOverlay(false);
  };
  const hasEpisodes = state.flags.length > 0;

  useRemoteKeys({
    overlayVisible: overlay,
    panelOpen: !!panel,
    onActivity: bump,
    onCenter: center,
    onPlay: play,
    onPause: pause,
    onToggle: toggle,
    onShowControls: showControls,
    onShowEpisodes: () => (hasEpisodes ? openPanel('episodes') : showControls()),
    onNext: next,
    onPrev: prev,
    onSeeking: seekPreview,
    onSeekEnd: seekCommit,
  });

  const touch = useTouchGestures({
    width,
    onSingleTap: () => (overlay ? setOverlay(false) : showControls()),
    onDoubleTap: center,
    onSeeking: seekPreview,
    onSeekEnd: seekCommit,
  });

  const withActivity = (action: () => void) => () => {
    bump();
    action();
  };

  const Engine = engine?.Component;
  const statusText = STATUS_TEXT[state.status];
  const episode = selectEpisode(state);
  const title = state.title || source?.title || '播放';

  let panelContent: ReactElement | null = null;
  if (panel === 'episodes') {
    panelContent = (
      <EpisodePanel
        flags={state.flags}
        flagIndex={state.flagIndex}
        episodeIndex={state.episodeIndex}
        onSelect={(episodeIndex, flagIndex) => {
          setPanel(undefined);
          playEpisode(episodeIndex, flagIndex);
        }}
      />
    );
  } else if (panel === 'speed') {
    panelContent = (
      <SpeedPanel
        speed={state.speed}
        onSelect={(speed) => {
          setPanel(undefined);
          setSpeed(speed);
        }}
      />
    );
  } else if (panel === 'audio') {
    panelContent = (
      <AudioPanel
        tracks={state.tracks.audio}
        selected={state.audioTrack}
        onSelect={(id) => {
          setPanel(undefined);
          selectTrack('audio', id);
        }}
      />
    );
  } else if (panel === 'subtitle') {
    panelContent = (
      <SubtitlePanel
        tracks={state.tracks.text}
        selected={state.textTrack}
        external={source?.subtitles ?? []}
        onSelect={(id) => {
          setPanel(undefined);
          selectTrack('text', id);
        }}
        onAdd={(subtitle) => {
          setPanel(undefined);
          addSubtitle(subtitle);
        }}
      />
    );
  } else if (panel === 'engine') {
    panelContent = (
      <EnginePanel
        engines={listEngines()}
        preference={enginePreference}
        active={engine}
        onSelect={(preference) => {
          setPanel(undefined);
          switchEngine(preference);
        }}
      />
    );
  }

  return (
    <View style={styles.container} testID="player-screen">
      <StatusBar hidden />
      {Engine && source && state.status !== 'error' ? (
        <Engine
          key={sourceKey}
          ref={setEngineHandle}
          source={source}
          paused={state.paused}
          rate={state.speed}
          resizeMode={resizeMode}
          selectedAudioTrack={state.audioTrack}
          selectedTextTrack={state.textTrack}
          background={background}
          style={StyleSheet.absoluteFill}
          onEvent={onEngineEvent}
        />
      ) : null}
      <View style={StyleSheet.absoluteFill} testID="player-touch" {...touch} />
      {statusText ? (
        <View style={styles.center} pointerEvents="none" testID="player-status">
          <Text style={styles.statusTitle} numberOfLines={1}>
            {title}
          </Text>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      ) : null}
      {seekTarget !== undefined ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.seek} testID="player-seek-target">{`${formatTime(seekTarget)} / ${formatTime(state.duration)}`}</Text>
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View style={[StyleSheet.absoluteFill, styles.errorBox]}>
          <ErrorView testID="player-error" message={state.error ?? '播放失败'} onRetry={onReload} hasTVPreferredFocus />
        </View>
      ) : null}
      {overlay && state.status !== 'error' ? (
        <Controls
          title={title}
          episodeName={episode?.name}
          position={state.position}
          duration={state.duration}
          playing={isPlaying(state)}
          speed={state.speed}
          engineLabel={engine?.label}
          hasEpisodes={hasEpisodes}
          hasPrev={selectHasPrev(state)}
          hasNext={selectHasNext(state)}
          showBack={!isTV}
          onBack={onExit}
          onToggle={withActivity(toggle)}
          onPrev={withActivity(prev)}
          onNext={withActivity(next)}
          onSeek={(ms) => {
            bump();
            seek(ms);
          }}
          onPanel={openPanel}
        />
      ) : null}
      {notice ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText} testID="player-notice">
            {notice.text}
          </Text>
        </View>
      ) : null}
      {panel && panelContent ? (
        <Panel kind={panel} onClose={closePanel}>
          {panelContent}
        </Panel>
      ) : null}
    </View>
  );
}

/** Tracks the screen's focus; the player is the playback host only while focused. */
function useScreenFocus(navigation: RootStackScreenProps<'Player'>['navigation']): boolean {
  const [focused, setFocused] = useState(() => navigation.isFocused());
  useEffect(() => {
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}

export default function PlayerScreen({ navigation, route }: RootStackScreenProps<'Player'>) {
  const focused = useScreenFocus(navigation);
  // Retry re-opens the item from scratch (VOD detail and history, or the URL).
  const [reload, setReload] = useState(0);
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);
  return (
    <PlayerView
      key={reload}
      params={route.params}
      focused={focused}
      onExit={() => navigation.goBack()}
      onReload={() => setReload((n) => n + 1)}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  statusText: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body,
  },
  seek: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.remarkBackground,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  errorBox: {
    backgroundColor: colors.background,
  },
  notice: {
    position: 'absolute',
    top: spacing.xl,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.remarkBackground,
  },
  noticeText: {
    color: colors.text,
    fontSize: fontSize.body,
  },
});
