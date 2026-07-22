import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typo } from './theme';

interface EmptyStateProps {
  message: string;
  ctaLabel?: string;
  onPressCta?: () => void;
}

export function EmptyState({ message, ctaLabel, onPressCta }: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {ctaLabel && onPressCta ? (
        <Pressable style={styles.cta} onPress={onPressCta}>
          <Text style={styles.ctaLabel}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, flexGrow: 1 },
  message: { fontSize: typo.body, color: colors.textMuted, textAlign: 'center' },
  cta: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ctaLabel: { fontSize: typo.body, color: colors.primary, fontWeight: '600' },
});
