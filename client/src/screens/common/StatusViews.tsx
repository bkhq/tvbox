import { ActivityIndicator, Text, View } from 'react-native';

import { Button, color, scaledText, space, useScaledStyles, type Scaler } from '../../ui';

export interface ErrorViewProps {
  message: string;
  onRetry?: () => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
}

export function ErrorView({ message, onRetry, hasTVPreferredFocus, testID }: ErrorViewProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Button
          testID={testID ? `${testID}-retry` : undefined}
          title="重试"
          variant="primary"
          size="md"
          hasTVPreferredFocus={hasTVPreferredFocus}
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export function LoadingView({ text = '正在加载…' }: { text?: string }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.container}>
      <ActivityIndicator color={color.accent} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  container: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: s(space.md),
    padding: s(space.xl),
  },
  text: { ...scaledText(s).body, color: color.text2, textAlign: 'center' as const },
});
