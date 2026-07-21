import { StyleSheet, View } from 'react-native';
import { colors, radii } from './theme';

interface ProgressBarProps {
  /** 0..1 */
  ratio: number;
}

export function ProgressBar({ ratio }: ProgressBarProps): React.JSX.Element {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.round(clamped * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.primary },
});
