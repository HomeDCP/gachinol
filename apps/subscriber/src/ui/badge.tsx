import { StyleSheet, Text, View } from 'react-native';
import { badgeTone, radii, spacing, typo } from './theme';
import type { BadgeToneName } from './theme';

interface BadgeProps {
  label: string;
  tone: BadgeToneName;
}

export function Badge({ label, tone }: BadgeProps): React.JSX.Element {
  const palette = badgeTone[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: { fontSize: typo.caption, fontWeight: '600' },
});
