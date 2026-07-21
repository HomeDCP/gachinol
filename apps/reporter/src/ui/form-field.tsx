import { StyleSheet, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import { colors, spacing, typo } from './theme';

interface FormFieldProps {
  label: string;
  error?: string;
  /** 우측 보조 텍스트 (예: 글자 수 카운터) */
  hint?: string;
}

export function FormField({
  label,
  error,
  hint,
  children,
}: PropsWithChildren<FormFieldProps>): React.JSX.Element {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
  },
  label: { fontSize: typo.caption, fontWeight: '600', color: colors.textMuted },
  hint: { fontSize: typo.caption, color: colors.textMuted },
  error: { fontSize: typo.caption, color: colors.danger, marginTop: spacing.xs },
});
