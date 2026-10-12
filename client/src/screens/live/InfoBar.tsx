import { Image, StyleSheet, Text, View } from 'react-native';

import type { Channel } from '../../core/types';
import { type Epg, formatEpgItem } from '../../player/live';
import { colors, fontSize, radius, spacing } from '../../ui';
import { lineLabel, nowAndNext } from './liveModel';

/** LiveActivity's info widget, shown on channel or source change. */
export function InfoBar({ channel, line, logo, epg }: { channel: Channel; line: number; logo: string; epg?: Epg }) {
  const { current, next } = nowAndNext(epg);
  const label = lineLabel(channel, line);
  return (
    <View testID="live-info" style={styles.bar} pointerEvents="none">
      {logo !== '' ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" /> : null}
      <View style={styles.text}>
        <View style={styles.title}>
          {channel.number !== '' ? <Text style={styles.number}>{channel.number}</Text> : null}
          <Text style={styles.name} numberOfLines={1}>
            {channel.name}
          </Text>
          {label !== '' ? (
            <Text style={styles.line} testID="live-info-line">
              {label}
            </Text>
          ) : null}
        </View>
        {current ? (
          <Text style={styles.programme} numberOfLines={1} testID="live-info-current">
            {`当前：${formatEpgItem(current)}`}
          </Text>
        ) : null}
        {next ? (
          <Text style={styles.programme} numberOfLines={1} testID="live-info-next">
            {`下一个：${formatEpgItem(next)}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.remarkBackground,
  },
  logo: {
    width: 96,
    height: 54,
    marginRight: spacing.md,
  },
  text: {
    flex: 1,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  number: {
    marginRight: spacing.sm,
    color: colors.primary,
    fontSize: fontSize.heading,
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  line: {
    marginLeft: spacing.md,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  programme: {
    marginTop: spacing.xs,
    color: colors.text,
    fontSize: fontSize.body,
  },
});
