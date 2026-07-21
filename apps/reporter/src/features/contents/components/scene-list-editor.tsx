import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../../ui/button';
import { FormField } from '../../../ui/form-field';
import { colors, radii, spacing, typo } from '../../../ui/theme';
import { emptySceneForm } from '../validation';
import type { SceneFormValue } from '../validation';

interface SceneListEditorProps {
  scenes: SceneFormValue[];
  onChange(scenes: SceneFormValue[]): void;
  errors: Record<string, string>;
}

/** ③-2 장면 카드 편집기 — order는 배열 인덱스 파생 (위저드·초안 수정 공용) */
export function SceneListEditor({
  scenes,
  onChange,
  errors,
}: SceneListEditorProps): React.JSX.Element {
  const patch = (index: number, field: keyof SceneFormValue, value: string): void => {
    onChange(scenes.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };
  const remove = (index: number): void => {
    onChange(scenes.filter((_, i) => i !== index));
  };
  const move = (index: number, dir: -1 | 1): void => {
    const target = index + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <View>
      {errors.scenes ? <Text style={styles.listError}>{errors.scenes}</Text> : null}
      {scenes.map((scene, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>장면 {index + 1}</Text>
            <View style={styles.cardActions}>
              <Text style={styles.moveButton} onPress={() => move(index, -1)}>
                ↑
              </Text>
              <Text style={styles.moveButton} onPress={() => move(index, 1)}>
                ↓
              </Text>
              <Text style={styles.deleteButton} onPress={() => remove(index)}>
                삭제
              </Text>
            </View>
          </View>
          <FormField
            label="자막 (필수)"
            hint={`${scene.caption.length}/500`}
            error={errors[`scenes.${index}.caption`]}
          >
            <TextInput
              style={[styles.input, styles.multiline]}
              value={scene.caption}
              onChangeText={(v) => patch(index, 'caption', v)}
              placeholder="화면에 노출될 자막"
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </FormField>
          <FormField
            label="설명 (선택 — 편집·AI 분석 힌트)"
            error={errors[`scenes.${index}.description`]}
          >
            <TextInput
              style={[styles.input, styles.multiline]}
              value={scene.description}
              onChangeText={(v) => patch(index, 'description', v)}
              placeholder="편집 지시·분석 힌트"
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </FormField>
          <View style={styles.secRow}>
            <View style={styles.secField}>
              <FormField label="시작(초)" error={errors[`scenes.${index}.startSec`]}>
                <TextInput
                  style={styles.input}
                  value={scene.startSec}
                  onChangeText={(v) => patch(index, 'startSec', v)}
                  placeholder="빈칸 = 미정"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </FormField>
            </View>
            <View style={styles.secField}>
              <FormField label="끝(초)" error={errors[`scenes.${index}.endSec`]}>
                <TextInput
                  style={styles.input}
                  value={scene.endSec}
                  onChangeText={(v) => patch(index, 'endSec', v)}
                  placeholder="빈칸 = 미정"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </FormField>
            </View>
          </View>
        </View>
      ))}
      <Button
        label="＋ 장면 추가"
        variant="secondary"
        onPress={() => onChange([...scenes, emptySceneForm()])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listError: { color: colors.danger, fontSize: typo.caption, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardActions: { flexDirection: 'row', gap: spacing.md },
  moveButton: { fontSize: typo.body, color: colors.primary, paddingHorizontal: spacing.sm },
  deleteButton: { fontSize: typo.caption, color: colors.danger, paddingHorizontal: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typo.body,
    color: colors.text,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  secRow: { flexDirection: 'row', gap: spacing.md },
  secField: { flex: 1 },
});
