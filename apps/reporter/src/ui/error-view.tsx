import { StyleSheet, Text, View } from 'react-native';
import { Button } from './button';
import { colors, spacing, typo } from './theme';

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
        <Button label={retryLabel} onPress={onRetry} variant="secondary" style={styles.retry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, flexGrow: 1 },
  message: { fontSize: typo.body, color: colors.text, textAlign: 'center' },
  retry: { marginTop: spacing.lg },
});
