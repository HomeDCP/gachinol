import { StyleSheet, Text, View } from 'react-native';
import { Button } from './button';
import { colors, spacing, typo } from './theme';

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
        <Button label={ctaLabel} onPress={onPressCta} variant="secondary" style={styles.cta} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, flexGrow: 1 },
  message: { fontSize: typo.body, color: colors.textMuted, textAlign: 'center' },
  cta: { marginTop: spacing.lg },
});
