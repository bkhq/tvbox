import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  AnimatedPressable,
  Badge,
  Button,
  Clock,
  color,
  FocusRing,
  Icon,
  safeArea,
  type Scaler,
  scaledText,
  space,
  tabular,
  useFocusAnimation,
  useScale,
  useScaledStyles,
} from '../../ui';
import { formatSpeed, formatTime } from './format';
import type { PanelKind } from './Panels';

/** The ±10 s buttons step by this much. */
export const SKIP_STEP = 10_000;

export interface ControlsProps {
  title: string;
  /** "第 N 集·…" line; omitted when there is no episode. */
  episodeLabel?: string;
  /** Resolution badge (selectQualityLabel). */
  quality?: string;
  position: number;
  duration: number;
  buffered: number;
  /** D-pad / gesture seek preview: shown in place of the position. */
  seekTarget?: number;
  playing: boolean;
  speed: number;
  subtitleName?: string;
  audioName?: string;
  hasEpisodes: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Current line name; the 画质 button is shown only when there are several lines. */
  lineName?: string;
  hasLines: boolean;
  /** Every press and focus change: restarts the auto-hide timer. */
  onActivity(): void;
  onBack(): void;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onSeek(ms: number): void;
  onPanel(kind: PanelKind): void;
}

function clamp(ms: number, duration: number): number {
  const target = Math.max(0, ms);
  return duration > 0 ? Math.min(duration, target) : target;
}

/** Vertical dark fade over the video; `down` darkens towards the bottom. */
function Fade({ id, down, style }: { id: string; down?: boolean; style: object }) {
  return (
    <Svg style={style} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.bg} stopOpacity={down ? 0 : 0.85} />
          <Stop offset="1" stopColor={color.bg} stopOpacity={down ? 0.94 : 0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Progress bar with the buffered segment and a round thumb, then elapsed / total times. */
export function SeekBar({
  position,
  duration,
  buffered,
  seekTarget,
  onSeek,
}: {
  position: number;
  duration: number;
  buffered: number;
  seekTarget?: number;
  onSeek?: (ms: number) => void;
}) {
  const styles = useScaledStyles(makeStyles);
  const [barWidth, setBarWidth] = useState(0);
  const shown = seekTarget ?? position;
  const ratio = (ms: number) => (duration > 0 ? Math.min(1, Math.max(0, ms / duration)) : 0);
  const played = ratio(shown);
  return (
    <View style={styles.progress}>
      <Pressable
        testID="player-seekbar"
        focusable={false}
        style={styles.bar}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (onSeek && barWidth > 0 && duration > 0) onSeek((event.nativeEvent.locationX / barWidth) * duration);
        }}
      >
        <View style={styles.track} />
        <View testID="player-buffered" style={[styles.track, styles.buffered, { width: `${ratio(buffered) * 100}%` }]} />
        <View testID="player-played" style={[styles.track, styles.played, { width: `${played * 100}%` }]} />
        <View style={[styles.thumb, { left: `${played * 100}%` }]} />
      </Pressable>
      <View style={styles.times}>
        {seekTarget !== undefined ? (
          <Text style={styles.time} testID="player-seek-target">
            {formatTime(seekTarget)}
          </Text>
        ) : (
          <Text style={styles.time}>{formatTime(position)}</Text>
        )}
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

/** Seek preview while the OSD is hidden: the bottom fade and the progress bar only. */
export function SeekOverlay(props: { position: number; duration: number; buffered: number; seekTarget: number }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fade id="playerSeekFade" down style={styles.bottomFade} />
      <View style={styles.bottom}>
        <SeekBar {...props} />
      </View>
    </View>
  );
}

/** The big round play / pause button: white fill, outer ring and zoom when focused. */
function PlayButton({ playing, onPress, onFocus }: { playing: boolean; onPress(): void; onFocus(): void }) {
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus });
  return (
    <AnimatedPressable
      testID="player-play"
      accessibilityRole="button"
      accessibilityLabel={playing ? '暂停' : '播放'}
      hasTVPreferredFocus
      onPress={onPress}
      {...handlers}
      style={[styles.play, animatedStyle]}
    >
      {focused ? <FocusRing radius={s(PLAY_SIZE / 2)} /> : null}
      <Icon name={playing ? 'pause' : 'play'} size={44} color={color.inverseText} />
    </AnimatedPressable>
  );
}

/** OSD over the video (VideoActivity control view): title, progress and the three button groups. */
export function Controls(props: ControlsProps) {
  const { title, episodeLabel, quality, position, duration, buffered, seekTarget, speed, onActivity, onPanel } = props;
  const styles = useScaledStyles(makeStyles);
  const press = (action: () => void) => () => {
    onActivity();
    action();
  };
  const panel = (kind: PanelKind) => press(() => onPanel(kind));
  const skip = (offset: number) => press(() => props.onSeek(clamp(position + offset, duration)));
  const common = { size: 'md' as const, onFocus: onActivity };
  return (
    <View style={styles.container} pointerEvents="box-none" testID="player-controls">
      <Fade id="playerTopFade" style={styles.topFade} />
      <Fade id="playerBottomFade" down style={styles.bottomFade} />
      <View style={styles.top}>
        <View style={styles.group}>
          <Button
            testID="player-back"
            variant="icon"
            icon="back"
            accessibilityLabel="返回"
            style={styles.back}
            {...common}
            onPress={press(props.onBack)}
          />
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {episodeLabel ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {episodeLabel}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.status}>
          {quality ? <Badge testID="player-quality" label={quality} /> : null}
          <Clock testID="player-clock" style={styles.clock} />
        </View>
      </View>
      <View style={styles.bottom}>
        <SeekBar
          position={position}
          duration={duration}
          buffered={buffered}
          seekTarget={seekTarget}
          onSeek={(ms) => {
            onActivity();
            props.onSeek(ms);
          }}
        />
        <View style={styles.actions}>
          <View style={[styles.group, styles.side]}>
            <Button testID="player-speed" icon="speed" title={formatSpeed(speed)} {...common} onPress={panel('speed')} />
            <Button
              testID="player-subtitle"
              icon="subtitles"
              title={props.subtitleName ? `字幕·${props.subtitleName}` : '字幕'}
              {...common}
              onPress={panel('subtitle')}
            />
            <Button
              testID="player-audio"
              icon="volume"
              title={props.audioName ? `音轨·${props.audioName}` : '音轨'}
              {...common}
              onPress={panel('audio')}
            />
          </View>
          <View style={[styles.group, styles.transport]}>
            {props.hasEpisodes ? (
              <Button
                testID="player-prev"
                variant="icon"
                icon="skipPrevious"
                accessibilityLabel="上一集"
                disabled={!props.hasPrev}
                {...common}
                onPress={press(props.onPrev)}
              />
            ) : null}
            <Button
              testID="player-rewind"
              variant="icon"
              icon="replay10"
              accessibilityLabel="后退 10 秒"
              {...common}
              onPress={skip(-SKIP_STEP)}
            />
            <PlayButton playing={props.playing} onFocus={onActivity} onPress={press(props.onToggle)} />
            <Button
              testID="player-forward"
              variant="icon"
              icon="forward10"
              accessibilityLabel="前进 10 秒"
              {...common}
              onPress={skip(SKIP_STEP)}
            />
            {props.hasEpisodes ? (
              <Button
                testID="player-next"
                variant="icon"
                icon="skipNext"
                accessibilityLabel="下一集"
                disabled={!props.hasNext}
                {...common}
                onPress={press(props.onNext)}
              />
            ) : null}
          </View>
          <View style={[styles.group, styles.side, styles.end]}>
            {props.hasEpisodes ? (
              <Button testID="player-episodes" icon="episodes" title="选集" {...common} onPress={panel('episodes')} />
            ) : null}
            {props.hasLines ? (
              <Button
                testID="player-line"
                title={props.lineName ? `画质·${props.lineName}` : '画质'}
                {...common}
                onPress={panel('line')}
              />
            ) : null}
            <Button
              testID="player-engine"
              variant="icon"
              icon="settings"
              accessibilityLabel="设置"
              {...common}
              onPress={panel('settings')}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const PLAY_SIZE = 96;

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    container: { ...StyleSheet.absoluteFill },
    topFade: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: s(260) },
    bottomFade: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: s(460) },
    top: {
      position: 'absolute' as const,
      top: s(safeArea.vertical),
      left: s(safeArea.horizontal),
      right: s(safeArea.horizontal),
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    group: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(12) },
    back: { width: s(56), height: s(56), borderRadius: s(28) },
    titles: { flexShrink: 1, marginLeft: s(12), gap: s(6) },
    title: { ...t.h2, fontFamily: t.h1.fontFamily, color: color.text },
    subtitle: { ...t.caption, color: color.text2 },
    status: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(12) },
    clock: { marginLeft: s(space.sm), fontSize: s(29) },
    bottom: {
      position: 'absolute' as const,
      left: s(safeArea.horizontal),
      right: s(safeArea.horizontal),
      bottom: s(64),
      gap: s(28),
    },
    progress: { gap: s(14) },
    bar: { height: s(28), justifyContent: 'center' as const },
    track: {
      position: 'absolute' as const,
      left: 0,
      top: s(9),
      width: '100%' as const,
      height: s(10),
      borderRadius: s(5),
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    buffered: { backgroundColor: 'rgba(255,255,255,0.45)' },
    played: { backgroundColor: color.accent },
    thumb: {
      position: 'absolute' as const,
      top: s(2),
      width: s(24),
      height: s(24),
      marginLeft: -s(12),
      borderRadius: s(12),
      backgroundColor: color.focusBorder,
    },
    times: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    time: { ...t.label, ...tabular, color: color.text2 },
    actions: { flexDirection: 'row' as const, alignItems: 'center' as const },
    side: { flex: 1 },
    end: { justifyContent: 'flex-end' as const },
    transport: { gap: s(28), marginHorizontal: s(space.md) },
    play: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      width: s(PLAY_SIZE),
      height: s(PLAY_SIZE),
      borderRadius: s(PLAY_SIZE / 2),
      backgroundColor: color.focusBorder,
    },
  };
};
