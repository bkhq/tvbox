import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, FocusableButton, fontSize, spacing } from '../../ui';

export interface ErrorViewProps {
  message: string;
  onRetry?: () => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
}

export function ErrorView({ message, onRetry, hasTVPreferredFocus, testID }: ErrorViewProps) {
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <FocusableButton
          testID={testID ? `${testID}-retry` : undefined}
          title="重试"
          hasTVPreferredFocus={hasTVPreferredFocus}
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export function LoadingView({ text = '正在加载…' }: { text?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  text: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
