import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, FocusableButton, fontSize, radius, spacing } from '../../ui';
import { formatSpeed, formatTime } from './format';
import type { PanelKind } from './Panels';

export interface ControlsProps {
  title: string;
  episodeName?: string;
  position: number;
  duration: number;
  playing: boolean;
  speed: number;
  engineLabel?: string;
  hasEpisodes: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Phones get a back button; TV uses the remote's back key. */
  showBack: boolean;
  onBack(): void;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onSeek(ms: number): void;
  onPanel(kind: PanelKind): void;
}

/** Controls overlay (VideoActivity control view): title, progress and actions. */
export function Controls(props: ControlsProps) {
  const { title, episodeName, position, duration, playing, speed, engineLabel, hasEpisodes, hasPrev, hasNext, onPanel } = props;
  const [barWidth, setBarWidth] = useState(0);
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  return (
    <View style={styles.container} pointerEvents="box-none" testID="player-controls">
      <View style={styles.top}>
        {props.showBack ? <FocusableButton testID="player-back" title="返回" onPress={props.onBack} /> : null}
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {episodeName ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {episodeName}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <View style={styles.progressRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Pressable
            testID="player-seekbar"
            focusable={false}
            style={styles.bar}
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
            onPress={(event) => {
              if (barWidth > 0 && duration > 0) props.onSeek((event.nativeEvent.locationX / barWidth) * duration);
            }}
          >
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
          </Pressable>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
        <View style={styles.actions}>
          <FocusableButton testID="player-play" title={playing ? '暂停' : '播放'} hasTVPreferredFocus onPress={props.onToggle} />
          {hasEpisodes ? (
            <>
              <FocusableButton testID="player-prev" title="上一集" disabled={!hasPrev} onPress={props.onPrev} />
              <FocusableButton testID="player-next" title="下一集" disabled={!hasNext} onPress={props.onNext} />
              <FocusableButton testID="player-episodes" title="选集" onPress={() => onPanel('episodes')} />
            </>
          ) : null}
          <FocusableButton testID="player-speed" title={`倍速 ${formatSpeed(speed)}`} onPress={() => onPanel('speed')} />
          <FocusableButton testID="player-audio" title="音轨" onPress={() => onPanel('audio')} />
          <FocusableButton testID="player-subtitle" title="字幕" onPress={() => onPanel('subtitle')} />
          <FocusableButton testID="player-engine" title={engineLabel ?? '播放器'} onPress={() => onPanel('engine')} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.remarkBackground,
  },
  titles: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.heading,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  bottom: {
    padding: spacing.lg,
    backgroundColor: colors.remarkBackground,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: {
    color: colors.text,
    fontSize: fontSize.caption,
    minWidth: 56,
    textAlign: 'center',
  },
  bar: {
    flex: 1,
    height: 16,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  fill: {
    height: '100%',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
