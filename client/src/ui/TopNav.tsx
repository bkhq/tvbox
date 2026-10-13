import type { ReactNode } from 'react';
import { StyleSheet, TVFocusGuideView, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { MainNavItem, MainNavKey } from '../navigation/mainNav';
import { AnimatedPressable, FocusRing } from './Button';
import { Clock } from './Clock';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { useScale, useScaledStyles, type Scaler } from './scale';
import { color, focus, safeArea } from './tokens';
import { Tab } from './Tab';
import { useFocusAnimation } from './useFocusAnimation';

export interface TopNavProps {
  /** Visible tabs, as returned by useMainNav. */
  items: readonly MainNavItem[];
  onSelect: (key: MainNavKey) => void;
  onSearch?: () => void;
  /** Icon buttons right of the clock, e.g. site switch and phone control. */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT = 150;
const SEARCH_SIZE = 52;

/**
 * Header of the main screens. On TV the bar is a focus guide: moving up from the content
 * lands on it and left/right moves stay inside it.
 */
export function TopNav({ items, onSelect, onSearch, right, style, testID }: TopNavProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <TVFocusGuideView testID={testID} autoFocus trapFocusLeft trapFocusRight style={[styles.bar, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="topNavFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bg} stopOpacity={0.96} />
            <Stop offset="0.55" stopColor={color.bg} stopOpacity={0.7} />
            <Stop offset="1" stopColor={color.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#topNavFade)" />
      </Svg>
      <View style={styles.left}>
        <Logo />
        <View style={styles.nav}>
          <SearchButton onPress={onSearch} />
          {items.map((item) => (
            <Tab
              key={item.key}
              testID={`top-nav-${item.key}`}
              label={item.label}
              active={item.active}
              onPress={() => onSelect(item.key)}
            />
          ))}
        </View>
      </View>
      <View style={styles.right}>
        <Clock style={styles.clock} />
        {right}
      </View>
    </TVFocusGuideView>
  );
}

function SearchButton({ onPress }: { onPress?: () => void }) {
  const { s } = useScale();
  const { focused, animatedStyle, handlers } = useFocusAnimation();
  const styles = useScaledStyles(makeStyles);
  return (
    <AnimatedPressable
      testID="top-nav-search"
      accessibilityRole="button"
      accessibilityLabel="搜索"
      onPress={onPress}
      {...handlers}
      style={[styles.search, focused && styles.searchFocused, animatedStyle]}
    >
      {focused ? <FocusRing radius={s(SEARCH_SIZE) / 2} /> : null}
      <Icon name="search" size={28} color={focused ? color.inverseText : color.text2} />
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => ({
  bar: {
    width: '100%' as const,
    height: s(HEIGHT),
    paddingTop: s(44),
    paddingHorizontal: s(safeArea.horizontal),
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
  },
  left: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(44) },
  nav: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(40), marginLeft: s(16) },
  right: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(20) },
  clock: { marginRight: s(8) },
  search: {
    width: s(SEARCH_SIZE),
    height: s(SEARCH_SIZE),
    borderRadius: s(SEARCH_SIZE) / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  searchFocused: { backgroundColor: focus.borderColor },
});
