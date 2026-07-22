import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typo } from './theme';

interface ErrorViewProps {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorView({
  message,
  retryLabel = '다시 시도',
  onRetry,
}: ErrorViewProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retry} onPress={onRetry}>
          <Text style={styles.retryLabel}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, flexGrow: 1 },
  message: { fontSize: typo.body, color: colors.text, textAlign: 'center' },
  retry: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryLabel: { fontSize: typo.body, color: colors.primary, fontWeight: '600' },
});
