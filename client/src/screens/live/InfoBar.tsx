import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Channel } from '../../core/types';
import { type Epg, formatEpgItem } from '../../player/live';
import {
  Badge,
  color,
  imageSource,
  safeArea,
  type Scaler,
  scaledText,
  space,
  tabular,
  useScaledStyles,
} from '../../ui';
import { lineLabel, nowAndNext, programmeProgress } from './liveModel';

/** LiveActivity's info widget, shown on channel or source change. */
export function InfoBar({ channel, line, logo, epg }: { channel: Channel; line: number; logo: string; epg?: Epg }) {
  const styles = useScaledStyles(makeStyles);
  const { current, next } = nowAndNext(epg);
  const label = lineLabel(channel, line);
  return (
    <View testID="live-info" style={styles.bar} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="live-info-shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={0.94} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#live-info-shade)" />
      </Svg>
      <View style={styles.content}>
        {channel.number !== '' ? (
          <Text style={styles.number} numberOfLines={1}>
            {channel.number}
          </Text>
        ) : logo !== '' ? (
          <Image testID="live-info-logo" source={imageSource(logo)} style={styles.logo} resizeMode="contain" />
        ) : null}
        <View style={styles.text}>
          <View style={styles.title}>
            <Text style={styles.name} numberOfLines={1}>
              {channel.name}
            </Text>
            {label !== '' ? <Badge testID="live-info-line" label={label} /> : null}
          </View>
          {current ? (
            <View style={styles.current}>
              <Text style={styles.programme} numberOfLines={1} testID="live-info-current">
                {`当前：${formatEpgItem(current)}`}
              </Text>
              <View style={styles.track}>
                <View
                  testID="live-info-progress"
                  style={[styles.fill, { width: `${Math.round((programmeProgress(current)?.fraction ?? 0) * 100)}%` }]}
                />
              </View>
            </View>
          ) : null}
          {next ? (
            <Text style={styles.next} numberOfLines={1} testID="live-info-next">
              {`下一个：${formatEpgItem(next)}`}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    bar: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      bottom: 0,
      height: s(520),
      justifyContent: 'flex-end' as const,
    },
    content: {
      flexDirection: 'row' as const,
      alignItems: 'flex-end' as const,
      gap: s(28),
      paddingHorizontal: s(safeArea.horizontal),
      paddingBottom: s(64),
    },
    number: { ...t.display, ...tabular, fontSize: s(96), lineHeight: s(96), letterSpacing: -s(2), color: color.text },
    logo: { width: s(160), height: s(90) },
    text: { flexShrink: 1, gap: s(10), marginBottom: s(4) },
    title: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(14) },
    name: { ...t.h1, flexShrink: 1, color: color.text },
    current: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.sm) },
    programme: { ...t.body, ...tabular, flexShrink: 1, color: color.text },
    track: { width: s(320), height: s(6), borderRadius: s(3), backgroundColor: 'rgba(255,255,255,0.25)' },
    fill: { height: s(6), borderRadius: s(3), backgroundColor: color.accent },
    next: { ...t.label, ...tabular, color: color.text2 },
  };
};
