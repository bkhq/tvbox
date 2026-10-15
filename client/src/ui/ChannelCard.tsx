import { memo, useMemo } from 'react';
import { Image, Text, View } from 'react-native';

import { Badge } from './Badge';
import { AnimatedPressable, type FocusableProps } from './Button';
import { Icon } from './Icon';
import { imageSource } from './imageSource';
import { useScaledStyles, type Scaler } from './scale';
import { card, color, focus, radii } from './tokens';
import { fontFamily, scaledText, tabular } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface ChannelCardProps extends FocusableProps {
  /** Channel number, e.g. "02". */
  number: string;
  name: string;
  /** Programme on air now. */
  program?: string;
  /** Logo url; shown in place of the number. */
  logo?: string;
  /** The channel currently playing. */
  playing?: boolean;
  favourite?: boolean;
}

// Channel tile of the live mockup.
const tile = { width: 260, height: 146 } as const;
const idleFill = 'rgba(255,255,255,0.08)';

function ChannelCardImpl({
  number,
  name,
  program,
  logo,
  playing = false,
  favourite = false,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: ChannelCardProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  const source = useMemo(() => imageSource(logo), [logo]);
  const bright = focused || playing;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${number} ${name}`}
      accessibilityState={{ selected: playing, disabled }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[styles.card, focused ? styles.focused : playing ? styles.playing : null, style, animatedStyle]}
      {...nextFocus}
    >
      {source ? (
        <Image source={source} style={styles.logo} resizeMode="contain" resizeMethod="resize" />
      ) : (
        <Text style={[styles.number, bright && styles.bright]}>{number}</Text>
      )}
      <View style={styles.marks}>
        {favourite ? <Icon name="heartFilled" size={20} color={color.accent} /> : null}
        {playing ? <Badge label="正在看" variant="live" /> : null}
      </View>
      <Text numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      {program ? (
        <Text numberOfLines={1} style={[styles.program, bright && styles.bright]}>
          {program}
        </Text>
      ) : null}
      {focused ? <View pointerEvents="none" style={styles.focusBorder} /> : null}
    </AnimatedPressable>
  );
}

export const ChannelCard = memo(ChannelCardImpl);

const makeStyles = (s: Scaler) => {
  const { label, caption } = scaledText(s);
  return {
    card: {
      width: s(tile.width),
      height: s(tile.height),
      justifyContent: 'flex-end' as const,
      gap: s(4),
      paddingVertical: s(16),
      paddingHorizontal: s(18),
      borderRadius: s(radii.button),
      backgroundColor: idleFill,
    },
    playing: { backgroundColor: color.buttonFill },
    focused: { backgroundColor: color.surface2 },
    number: {
      ...tabular,
      position: 'absolute' as const,
      top: s(14),
      left: s(18),
      fontFamily: fontFamily.bold,
      fontSize: s(31),
      lineHeight: s(38),
      color: color.text2,
    },
    // Half of the channel token box, so the logo clears the name line.
    logo: {
      position: 'absolute' as const,
      top: s(14),
      left: s(18),
      width: s(card.channel.width / 2),
      height: s(card.channel.height / 2),
    },
    marks: {
      position: 'absolute' as const,
      top: s(16),
      right: s(16),
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(8),
    },
    name: { ...label, fontFamily: fontFamily.semiBold, color: color.text },
    program: { ...caption, color: color.text2 },
    bright: { color: color.text },
    focusBorder: {
      position: 'absolute' as const,
      top: -s(focus.borderWidth),
      right: -s(focus.borderWidth),
      bottom: -s(focus.borderWidth),
      left: -s(focus.borderWidth),
      borderWidth: s(focus.borderWidth),
      borderColor: focus.borderColor,
      borderRadius: s(radii.button + focus.borderWidth),
    },
  };
};
