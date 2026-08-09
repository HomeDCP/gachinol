import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@gachinol/ui';

export function LoadingView(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
