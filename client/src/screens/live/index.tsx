import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { useSetting } from '../../core/settings/useSetting';
import type { Channel, Group, Live } from '../../core/types';
import type { RootStackParamList, RootStackScreenProps } from '../../navigation/types';
import { attachPlaybackHost, type SnapshotListener } from '../../player/controller';
import { getEngine } from '../../player/engine/registry';
import { type EngineEvent, resizeModeFromScale } from '../../player/engine/types';
import {
  attachLiveScreen,
  channelForKey,
  channelHeaders,
  channelUrl,
  isKeepGroup,
  keepValue,
  lineAfterError,
  type LivePosition,
  loadLiveGroups,
  loadLiveSources,
  moveChannel,
  readLiveState,
  saveLiveHome,
  saveLiveKeep,
  switchLine,
  unlockGroups,
} from '../../player/live';
import type { UrlPlayerParams } from '../../player/params';
import { toSnapshot, usePlayback } from '../../player/usePlayback';
import { color, type Scaler, scaledText, space, useLayout, useScaledStyles } from '../../ui';
import { ErrorView } from '../common';
import { fallbackNotice, NOTICE_DURATION } from '../player';
import { useBackgroundPause } from '../player/useBackgroundPause';
import { ChannelList } from './ChannelList';
import { InfoBar } from './InfoBar';
import { LiveBrowse } from './LiveBrowse';
import { toggleFavourite } from './liveFavourites';
import { initialSelection, type LiveSelection } from './liveModel';
import { LivePanel, PassPrompt } from './LivePanel';
import { LiveStatus } from './LiveStatus';
import { useLiveEpg } from './useLiveEpg';
import { useLiveGestures } from './useLiveGestures';
import { type LiveRemoteAction, useLiveRemote } from './useLiveRemote';

/** The info bar hides after this long. */
export const INFO_DURATION = 5_000;
/** LiveActivity.onItemClick(Group): presses on "收藏" that open the password prompt. */
export const PASS_PRESSES = 5;

type LiveParams = RootStackParamList['Live'];

const STATUS_TEXT: Partial<Record<string, string>> = {
  idle: '正在加载…',
  loading: '正在加载…',
  buffering: '缓冲中…',
};

interface LivePlayerProps {
  live: Live;
  lives: Live[];
  visible: Group[];
  hidden: Group[];
  start: LiveSelection;
  params: LiveParams;
  focused: boolean;
  onSelectLive(live: Live): void;
}

function LivePlayer({ live, lives, visible, hidden: initialHidden, start, params, focused, onSelectLive }: LivePlayerProps) {
  const { isTV } = useLayout();
  const ui = useScaledStyles(makeStyles);
  const [background] = useSetting('background');
  const [scaleLive] = useSetting('scaleLive');
  const [across] = useSetting('across');
  const [invert] = useSetting('invert');
  const [change] = useSetting('change');

  const [groups, setGroups] = useState(visible);
  const [hidden, setHidden] = useState(initialHidden);
  const [selection, setSelection] = useState(start);
  // browse: the TV live home over the playing channel; full: the full-screen player.
  const [mode, setMode] = useState<'browse' | 'full'>('browse');
  const [list, setList] = useState(false);
  const [panel, setPanel] = useState<'menu' | 'pass' | undefined>(undefined);
  const [info, setInfo] = useState(1);
  const [notice, setNotice] = useState<{ text: string; id: number } | undefined>(undefined);
  const keepPresses = useRef(0);
  const epg = useLiveEpg(live, visible);

  const showNotice = useCallback((text: string) => setNotice((current) => ({ text, id: (current?.id ?? 0) + 1 })), []);

  const select = useCallback((next: LiveSelection) => {
    setSelection(next);
    setInfo((n) => n + 1);
  }, []);

  // Route params select a channel when they change (state adjusted during render).
  const paramsKey = JSON.stringify(params ?? {});
  const [seenParams, setSeenParams] = useState(paramsKey);
  if (paramsKey !== seenParams) {
    setSeenParams(paramsKey);
    const channel = params?.groupIndex !== undefined ? groups[params.groupIndex]?.channel[params.channelIndex ?? 0] : undefined;
    if (channel) {
      select({ group: params!.groupIndex!, channel: params!.channelIndex ?? 0, line: 0 });
      setMode('browse');
    }
  }

  const group = groups[selection.group]!;
  const channel = group.channel[selection.channel]!;
  const url = channelUrl(channel, selection.line);
  const request = useMemo<UrlPlayerParams>(
    () => ({ url, title: channel.name, headers: channelHeaders(channel) }),
    [url, channel],
  );
  // The load watchdog takes the same line-switch path as engine errors (onEngineEvent is defined below).
  const timeoutRef = useRef<(event: EngineEvent) => void>(() => {});
  const playback = usePlayback(request, { attach: false, onLoadTimeout: (event) => timeoutRef.current(event) });
  const { state, source, sourceKey, engine, setEngineHandle, onEngineEvent: onPlaybackEvent, play, pause, toggle, stop, repeat, replay, seek, setSpeed } =
    playback;

  const latest = useRef({ groups, selection, channel, across, invert, change, state });
  useEffect(() => {
    latest.current = { groups, selection, channel, across, invert, change, state };
  });

  // Remember the channel (Live.keep) and load its programme guide.
  const { request: requestEpg } = epg;
  useEffect(() => {
    void saveLiveKeep(live.name, keepValue(group, channel, url));
    requestEpg(channel);
  }, [live.name, group, channel, url, requestEpg]);

  const moveTo = useCallback(
    (position: LivePosition | undefined) => {
      if (position) select({ ...position, line: 0 });
    },
    [select],
  );
  const step = useCallback(
    (delta: 1 | -1) => {
      const { groups: current, selection: at, across: wrapAcross } = latest.current;
      moveTo(moveChannel(current, at, delta, wrapAcross));
    },
    [moveTo],
  );
  const switchSource = useCallback(
    (next: boolean) => {
      const { selection: at, channel: current } = latest.current;
      select({ ...at, line: switchLine(current, at.line, next) });
    },
    [select],
  );

  // LivePlaybackController.fallbackAfterError: try the next source, then the engine fallback.
  const onEngineEvent = useCallback(
    (event: EngineEvent) => {
      if (event.type === 'error' && (event.fatal || event.phase === 'init')) {
        const { selection: at, channel: current, change: autoChange } = latest.current;
        const line = lineAfterError(current, at.line, autoChange);
        if (line !== undefined) {
          showNotice(`播放失败，切换到线路 ${line + 1}`);
          select({ ...at, line });
          return;
        }
      }
      onPlaybackEvent(event);
    },
    [onPlaybackEvent, select, showNotice],
  );
  useEffect(() => {
    timeoutRef.current = onEngineEvent;
  }, [onEngineEvent]);

  // Engine fallback toast (state adjusted during render).
  const fallbackKey = state.fallbackUsed && state.engine ? `${state.token}:${state.engine}` : '';
  const [seenFallback, setSeenFallback] = useState('');
  if (fallbackKey !== seenFallback) {
    setSeenFallback(fallbackKey);
    if (fallbackKey && state.engine) showNotice(fallbackNotice(getEngine(state.engine)?.label ?? state.engine));
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_DURATION);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (info === 0) return;
    const timer = setTimeout(() => setInfo(0), INFO_DURATION);
    return () => clearTimeout(timer);
  }, [info]);

  useBackgroundPause(background, pause);

  // LiveActivity.onStop: pause while another screen covers this one, resume on return.
  useEffect(() => {
    if (focused) return;
    pause();
    return play;
  }, [focused, pause, play]);

  // App-wide playback host and live select surface while focused.
  const pushes = useRef(new Set<SnapshotListener>());
  useEffect(() => {
    const snapshot = toSnapshot(state);
    for (const push of [...pushes.current]) push(snapshot);
  }, [state]);
  const visibleCount = visible.length;
  useEffect(() => {
    if (!focused) return;
    const listeners = pushes.current;
    const detachHost = attachPlaybackHost({
      play,
      pause,
      stop,
      prev: () => step(-1),
      next: () => step(1),
      repeat,
      replay,
      seekTo: seek,
      setSpeed,
      getState: () => toSnapshot(latest.current.state),
      subscribe(push) {
        listeners.add(push);
        return () => {
          listeners.delete(push);
        };
      },
    });
    const detachScreen = attachLiveScreen({
      getGroups: () => latest.current.groups.slice(0, visibleCount),
      selectChannel: (groupIndex, channelIndex) => {
        if (latest.current.groups[groupIndex]?.channel[channelIndex]) select({ group: groupIndex, channel: channelIndex, line: 0 });
      },
    });
    return () => {
      detachHost();
      detachScreen();
    };
  }, [focused, play, pause, stop, repeat, replay, seek, setSpeed, step, select, visibleCount]);

  const onRemote = (action: LiveRemoteAction) => {
    switch (action.type) {
      case 'channel':
        moveTo(channelForKey(groups, selection, action.key, { across, invert }));
        return;
      case 'step':
        step(action.delta);
        return;
      case 'line':
        switchSource(action.next);
        return;
      case 'list':
        // The error view's retry button takes OK.
        if (state.status !== 'error') setList(true);
        return;
      case 'menu':
        setPanel('menu');
        return;
      case 'toggle':
        toggle();
        return;
      case 'play':
        play();
        return;
      case 'pause':
        pause();
        return;
    }
  };
  useLiveRemote(mode !== 'full' || list || !!panel, onRemote);

  // Back in full mode returns to browse; in browse it leaves the screen.
  useEffect(() => {
    if (mode !== 'full' || !focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode('browse');
      return true;
    });
    return () => subscription.remove();
  }, [mode, focused]);

  const touch = useLiveGestures({
    onTap: () => setList((shown) => !shown),
    onSwipe: (direction) => step(direction === 'up' ? 1 : -1),
  });

  const onGroupPress = (index: number | undefined) => {
    // PassDialog after repeated presses on "收藏" while groups are locked.
    const pressed = index === undefined ? undefined : groups[index];
    if (!pressed || !isKeepGroup(pressed) || hidden.length === 0) {
      keepPresses.current = 0;
      return;
    }
    keepPresses.current += 1;
    if (keepPresses.current < PASS_PRESSES) return;
    keepPresses.current = 0;
    setList(false);
    setPanel('pass');
  };

  const unlock = (pass: string) => {
    setPanel(undefined);
    const result = unlockGroups(groups, hidden, pass);
    if (result.selected === undefined) {
      showNotice('密码错误');
      return;
    }
    setGroups(result.visible);
    setHidden(result.hidden);
    if (mode === 'full') setList(true);
  };

  const onToggleFavourite = (target: Channel) => {
    void toggleFavourite(latest.current.groups, target).then((result) => {
      const { selection: at, channel: current } = latest.current;
      setGroups(result.groups);
      // The keep group gained or lost a channel: keep pointing at the playing one.
      if (!isKeepGroup(result.groups[at.group]!)) return;
      const kept = result.groups[at.group]!.channel.findIndex((item) => item.name === current.name);
      if (kept === at.channel) return;
      if (kept >= 0) {
        setSelection({ ...at, channel: kept });
        return;
      }
      const group = result.groups.findIndex(
        (item) => !isKeepGroup(item) && item.channel.some((entry) => entry.name === current.name),
      );
      const moved =
        group >= 0
          ? { group, channel: result.groups[group]!.channel.findIndex((entry) => entry.name === current.name), line: 0 }
          : initialSelection(result.groups, undefined, '');
      if (moved) setSelection(moved);
    });
  };

  const Engine = engine?.Component;
  const statusText = STATUS_TEXT[state.status];
  const resizeMode = resizeModeFromScale(scaleLive);

  return (
    <View style={styles.container} testID="live-screen">
      <StatusBar hidden />
      {Engine && source && state.status !== 'error' ? (
        <Engine
          key={sourceKey}
          ref={setEngineHandle}
          source={source}
          paused={state.paused}
          rate={state.speed}
          resizeMode={resizeMode}
          background={background}
          style={StyleSheet.absoluteFill}
          onEvent={onEngineEvent}
        />
      ) : null}
      {mode === 'full' ? <View style={StyleSheet.absoluteFill} testID="live-touch" {...touch} /> : null}
      {statusText ? (
        <View style={styles.center} pointerEvents="none" testID="live-status">
          <ActivityIndicator color={color.accent} />
          <Text style={ui.statusText}>{statusText}</Text>
        </View>
      ) : null}
      {mode === 'browse' ? (
        <>
          {state.status === 'error' ? (
            <View style={styles.center} pointerEvents="none">
              <Text style={ui.statusText} testID="live-browse-error">{`${channel.name}：${state.error ?? '播放失败'}`}</Text>
            </View>
          ) : null}
          <LiveBrowse
            groups={groups}
            selection={selection}
            epg={epg}
            onGroupPress={onGroupPress}
            onSelect={(ref) => select({ ...ref, line: 0 })}
            onFull={() => setMode('full')}
            onToggleFavourite={onToggleFavourite}
          />
        </>
      ) : null}
      {mode === 'full' && state.status === 'error' ? (
        <View style={[StyleSheet.absoluteFill, ui.page]}>
          <ErrorView testID="live-error" message={`${channel.name}：${state.error ?? '播放失败'}`} onRetry={replay} hasTVPreferredFocus />
        </View>
      ) : null}
      {mode === 'full' && info > 0 && !list ? (
        <InfoBar channel={channel} line={selection.line} logo={epg.logoOf(channel)} epg={epg.epgFor(channel)} />
      ) : null}
      {notice ? (
        <View style={ui.notice} pointerEvents="none">
          <Text style={ui.noticeText} testID="live-notice">
            {notice.text}
          </Text>
        </View>
      ) : null}
      {list ? (
        <ChannelList
          groups={groups}
          selection={selection}
          epg={epg}
          isTV={isTV}
          onGroupPress={onGroupPress}
          onSelect={(groupIndex, channelIndex) => {
            setList(false);
            select({ group: groupIndex, channel: channelIndex, line: 0 });
          }}
          onClose={() => setList(false)}
          onMenu={() => {
            setList(false);
            setPanel('menu');
          }}
          onBack={
            isTV
              ? undefined
              : () => {
                  setList(false);
                  setMode('browse');
                }
          }
        />
      ) : null}
      {panel === 'menu' ? (
        <LivePanel
          lives={lives}
          home={live.name}
          onSelect={(next) => {
            setPanel(undefined);
            if (next.name !== live.name) onSelectLive(next);
          }}
          onClose={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'pass' ? <PassPrompt onSubmit={unlock} onClose={() => setPanel(undefined)} /> : null}
    </View>
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; title: string; detail: string }
  | { status: 'empty'; title: string }
  | { status: 'ready'; id: number; live: Live; visible: Group[]; hidden: Group[]; start: LiveSelection };

/** Loads the live sources and the selected source's channels, then plays. */
function LiveView({ params, focused, onReload }: { params: LiveParams; focused: boolean; onReload(): void }) {
  const vodConfig = useVodConfig();
  const vodLives = vodConfig.status === 'ready' ? vodConfig.config?.lives : undefined;
  const [lives, setLives] = useState<Live[]>([]);
  const [home, setHome] = useState<Live | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // The route position applies to the first source loaded only.
  const routeRef = useRef(params);
  const loads = useRef(0);

  useEffect(() => {
    if (vodConfig.status === 'loading') return;
    let cancelled = false;
    loadLiveSources({ vodLives: vodLives ?? [] }).then(
      (sources) => {
        if (cancelled) return;
        setLives(sources.lives);
        setHome(sources.home);
        if (!sources.home) setLoad({ status: 'empty', title: '暂无直播源' });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', title: '直播配置加载失败', detail: errorText(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vodConfig.status, vodLives]);

  useEffect(() => {
    if (!home) return;
    const controller = new AbortController();
    (async () => {
      const [{ live, visible, hidden }, state] = await Promise.all([
        loadLiveGroups(home, { signal: controller.signal }),
        readLiveState(),
      ]);
      if (controller.signal.aborted) return;
      const start = initialSelection(visible, routeRef.current, state.keep[home.name] ?? '');
      routeRef.current = undefined;
      const id = ++loads.current;
      setLoad(start ? { status: 'ready', id, live, visible, hidden, start } : { status: 'empty', title: '暂无频道' });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoad({ status: 'error', title: '频道加载失败', detail: errorText(error) });
      }
    });
    return () => controller.abort();
  }, [home]);

  const selectLive = useCallback((live: Live) => {
    void saveLiveHome(live.name);
    setLoad({ status: 'loading' });
    setHome(live);
  }, []);

  if (load.status !== 'ready') {
    return (
      <LiveStatus
        kind={load.status}
        title={load.status === 'loading' ? undefined : load.title}
        detail={load.status === 'error' ? load.detail : undefined}
        lives={lives}
        home={home?.name}
        onRetry={load.status === 'loading' ? undefined : onReload}
        onSelectLive={selectLive}
      />
    );
  }
  return (
    <LivePlayer
      key={load.id}
      live={load.live}
      lives={lives}
      visible={load.visible}
      hidden={load.hidden}
      start={load.start}
      params={params}
      focused={focused}
      onSelectLive={selectLive}
    />
  );
}

/** Tracks the screen's focus; the live screen is the playback host only while focused. */
function useScreenFocus(navigation: RootStackScreenProps<'Live'>['navigation']): boolean {
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

export default function LiveScreen({ navigation, route }: RootStackScreenProps<'Live'>) {
  const focused = useScreenFocus(navigation);
  const [reload, setReload] = useState(0);
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);
  return (
    <View style={styles.container}>
      <LiveView
        key={reload}
        params={route.params}
        focused={focused}
        onReload={() => setReload((n) => n + 1)}
      />
    </View>
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
});

const makeStyles = (s: Scaler) => {
  const { body } = scaledText(s);
  return {
    page: { backgroundColor: color.bg },
    statusText: { ...body, marginTop: s(space.sm), color: color.text },
    notice: {
      position: 'absolute' as const,
      top: s(150),
      alignSelf: 'center' as const,
      paddingHorizontal: s(22),
      paddingVertical: s(12),
      borderRadius: s(12),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
      backgroundColor: 'rgba(21,26,36,0.92)',
    },
    noticeText: { ...body, color: color.text },
  };
};
