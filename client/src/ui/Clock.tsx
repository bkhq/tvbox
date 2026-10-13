import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useScaledStyles, type Scaler } from './scale';
import { color } from './tokens';
import { scaledText, tabular } from './typography';

export interface ClockProps {
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Wall clock of the top bar (HH:mm), refreshed on each minute boundary. */
export function Clock({ style, testID }: ClockProps) {
  const styles = useScaledStyles(makeStyles);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000));
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <Text testID={testID} style={[styles.clock, style]}>
      {formatClock(now)}
    </Text>
  );
}

const makeStyles = (s: Scaler) => ({
  clock: { ...scaledText(s).body, ...tabular, fontSize: s(26), lineHeight: s(36), color: color.text2 },
});
