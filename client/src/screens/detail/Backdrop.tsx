import { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { color, imageSource, useScaledStyles, type Scaler } from '../../ui';

const HEIGHT = 700;

/** Blurred poster behind the top of the page, faded into the background to the left and bottom. */
export function Backdrop({ uri }: { uri?: string }) {
  const styles = useScaledStyles(makeStyles);
  const source = useMemo(() => imageSource(uri), [uri]);
  if (!source) return null;
  return (
    <View pointerEvents="none" style={styles.backdrop} testID="detail-backdrop">
      <Image source={source} blurRadius={24} resizeMode="cover" resizeMethod="resize" style={styles.image} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="detailFadeX" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color.bg} stopOpacity={1} />
            <Stop offset="0.33" stopColor={color.bg} stopOpacity={0.85} />
            <Stop offset="0.7" stopColor={color.bg} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="detailFadeY" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.57" stopColor={color.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#detailFadeX)" />
        <Rect width="100%" height="100%" fill="url(#detailFadeY)" />
      </Svg>
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  backdrop: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: s(HEIGHT) },
  image: { ...StyleSheet.absoluteFill, opacity: 0.6 },
});
