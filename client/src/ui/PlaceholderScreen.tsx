import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from './theme';

export interface PlaceholderScreenProps {
  title: string;
}

/** Centered title plus a "work in progress" note for unimplemented screens. */
export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>开发中</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.display,
  },
  note: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
