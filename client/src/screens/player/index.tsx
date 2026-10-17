import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useSetting } from '../../core/settings/useSetting';
import type { RootStackScreenProps } from '../../navigation/types';
import { getEngine, listEngines } from '../../player/engine/registry';
import type { PlayerParams } from '../../player/params';
import { usePlayback } from '../../player/usePlayback';
import type { Track, TrackId } from '../../player/engine/types';
import {
  isPlaying,
  selectEpisode,
  selectFlag,
  selectHasNext,
  selectHasPrev,
  selectQualityLabel,
} from '../../player/machine';
import { color, radii, type Scaler, scaledText, space, useScaledStyles } from '../../ui';
import { ErrorView } from '../common';
import { Controls, SeekOverlay } from './Controls';
import { episodeLabel, trackLabel } from './format';
import {
  AudioPanel,
  EpisodePanel,
  LinePanel,
  Panel,
  type PanelKind,
  SettingsPanel,
  SpeedPanel,
  SubtitlePanel,
} from './Panels';
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

/** Name of the chosen track (or the engine's default one); null = off. */
function trackName(tracks: Track[], selected: TrackId | null | undefined): string | undefined {
  if (selected === null) return undefined;
  const track = tracks.find((item) => (selected === undefined ? item.selected : item.id === selected));
  return track ? trackLabel(track) : undefined;
}

interface PlayerViewProps {
  params: PlayerParams;
  focused: boolean;
  onExit(): void;
  onReload(): void;
}

function PlayerView({ params, focused, onExit, onReload }: PlayerViewProps) {
  const styles = useScaledStyles(makeStyles);
  const { width } = useWindowDimensions();
  const [background] = useSetting('background');
  const [enginePreference] = useSetting('playerEngine');
  const [scale, setScale] = useSetting('scale');
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
    switchFlag,
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

  // Paused, the controls stay until playback resumes or back hides them.
  useEffect(() => {
    if (!overlay || panel || state.paused) return;
    const timer = setTimeout(() => setOverlay(false), CONTROLS_HIDE_DELAY);
    return () => clearTimeout(timer);
  }, [overlay, panel, activity, state.paused]);

  useBackgroundPause(background, pause);

  useEffect(() => {
    if (!focused) pause();
  }, [focused, pause]);

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

  // Back closes an open panel only (in case its modal lost window focus), then the controls.
  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) {
        closePanel();
        return true;
      }
      if (!overlay) return false;
      setOverlay(false);
      return true;
    });
    return () => subscription.remove();
  }, [focused, overlay, panel, closePanel]);

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
  // VideoActivity.onKeyCenter / onPlayingChanged: pausing from the remote shows the controls with 播放 focused,
  // resuming hides them. Pauses on blur or in the background leave the overlay alone.
  const userPause = () => {
    pause();
    setOverlay(true);
  };
  const userToggle = () => {
    const resuming = stateRef.current.paused;
    toggle();
    setOverlay(!resuming);
  };
  const hasEpisodes = state.flags.length > 0;

  useRemoteKeys({
    overlayVisible: overlay,
    panelOpen: !!panel,
    onActivity: bump,
    onCenter: userToggle,
    onPlay: play,
    onPause: userPause,
    onToggle: userToggle,
    onShowControls: showControls,
    onShowEpisodes: () => (hasEpisodes ? openPanel('episodes') : showControls()),
    onNext: next,
    onPrev: prev,
    onSeeking: seekPreview,
    onSeekEnd: seekCommit,
  }, focused);

  const touch = useTouchGestures({
    width,
    onSingleTap: () => (overlay ? setOverlay(false) : showControls()),
    onDoubleTap: userToggle,
    onSeeking: seekPreview,
    onSeekEnd: seekCommit,
  });

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
  } else if (panel === 'line') {
    panelContent = (
      <LinePanel
        flags={state.flags}
        flagIndex={state.flagIndex}
        onSelect={(flagIndex) => {
          setPanel(undefined);
          switchFlag(flagIndex);
        }}
      />
    );
  } else if (panel === 'settings') {
    panelContent = (
      <SettingsPanel
        engines={listEngines()}
        preference={enginePreference}
        active={engine}
        scale={scale}
        onSelectEngine={(preference) => {
          setPanel(undefined);
          switchEngine(preference);
        }}
        onSelectScale={(value) => {
          setPanel(undefined);
          void setScale(value);
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
          paused={!focused || state.paused}
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
          <View style={styles.statusBox}>
            <Text style={styles.statusTitle} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.statusRow}>
              <ActivityIndicator color={color.accent} />
              <Text style={styles.statusText}>{statusText}</Text>
            </View>
          </View>
        </View>
      ) : null}
      {seekTarget !== undefined && !overlay && state.status !== 'error' ? (
        <SeekOverlay position={state.position} duration={state.duration} buffered={state.buffered} seekTarget={seekTarget} />
      ) : null}
      {state.status === 'error' ? (
        <View style={[StyleSheet.absoluteFill, styles.errorBox]}>
          <ErrorView testID="player-error" message={state.error ?? '播放失败'} onRetry={onReload} hasTVPreferredFocus />
        </View>
      ) : null}
      {overlay && state.status !== 'error' ? (
        <Controls
          title={title}
          episodeLabel={episode ? episodeLabel(state.episodeIndex, episode.name) : undefined}
          quality={selectQualityLabel(state)}
          position={state.position}
          duration={state.duration}
          buffered={state.buffered}
          seekTarget={seekTarget}
          playing={isPlaying(state)}
          speed={state.speed}
          subtitleName={trackName(state.tracks.text, state.textTrack)}
          audioName={trackName(state.tracks.audio, state.audioTrack)}
          hasEpisodes={hasEpisodes}
          hasPrev={selectHasPrev(state)}
          hasNext={selectHasNext(state)}
          lineName={selectFlag(state)?.flag}
          hasLines={state.flags.length > 1}
          onActivity={bump}
          onBack={onExit}
          onToggle={toggle}
          onPrev={prev}
          onNext={next}
          onSeek={seek}
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

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  const pill = {
    paddingHorizontal: s(space.md),
    paddingVertical: s(space.sm),
    borderRadius: s(radii.button),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: color.surface,
  };
  return {
    container: { flex: 1, backgroundColor: '#000000' },
    center: { ...StyleSheet.absoluteFill, alignItems: 'center' as const, justifyContent: 'center' as const },
    statusBox: { ...pill, alignItems: 'center' as const, maxWidth: s(960), gap: s(space.xs) },
    statusTitle: { ...t.h2, color: color.text },
    statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm) },
    statusText: { ...t.body, color: color.text2 },
    errorBox: { backgroundColor: color.bg },
    notice: { ...pill, position: 'absolute' as const, top: s(space.xl), alignSelf: 'center' as const },
    noticeText: { ...t.body, color: color.text },
  };
};
