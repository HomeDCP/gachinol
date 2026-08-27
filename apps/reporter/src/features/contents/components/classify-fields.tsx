import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CultureTopic, ProgramCategory, requiresCultureTopic } from '@gachinol/shared';
import type { CultureTopic as CultureTopicType } from '@gachinol/shared';
import { FormField } from '../../../ui/form-field';
import { colors, radii, spacing, typo } from '../../../ui/theme';
import { CATEGORY_HELP, CATEGORY_LABEL, CULTURE_TOPIC_LABEL } from '../labels';
import type { ClassifyFormValue } from '../validation';

interface ClassifyFieldsProps {
  value: ClassifyFormValue;
  onChange(patch: Partial<ClassifyFormValue>): void;
  errors: Record<string, string>;
}

/** ③-3 제목·설명·분류(6종 라디오)·교양 토픽(멀티 칩) — 위저드·초안 수정 공용 */
export function ClassifyFields({
  value,
  onChange,
  errors,
}: ClassifyFieldsProps): React.JSX.Element {
  const toggleTopic = (topic: CultureTopicType): void => {
    const has = value.cultureTopics.includes(topic);
    onChange({
      cultureTopics: has
        ? value.cultureTopics.filter((t) => t !== topic)
        : [...value.cultureTopics, topic],
    });
  };

  return (
    <View>
      <FormField label="제목 (필수)" hint={`${value.title.length}/200`} error={errors.title}>
        <TextInput
          style={styles.input}
          value={value.title}
          onChangeText={(title) => onChange({ title })}
          placeholder="콘텐츠 제목"
          placeholderTextColor={colors.textMuted}
          maxLength={200}
        />
      </FormField>
      <FormField label="설명 (선택)" error={errors.description}>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={value.description}
          onChangeText={(description) => onChange({ description })}
          placeholder="콘텐츠 설명"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={5000}
        />
      </FormField>
      <FormField label="분류 (필수)" error={errors.category}>
        <View style={styles.chipWrap}>
          {Object.values(ProgramCategory).map((category) => {
            const selected = value.category === category;
            return (
              <Pressable
                key={category}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => onChange({ category })}
              >
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                  {CATEGORY_LABEL[category]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {value.category && CATEGORY_HELP[value.category] ? (
          <Text style={styles.help}>{CATEGORY_HELP[value.category]}</Text>
        ) : null}
      </FormField>
      {value.category && requiresCultureTopic(value.category) ? (
        <FormField label="교양 하위 토픽 (1개 이상)" error={errors.cultureTopics}>
          <View style={styles.chipWrap}>
            {Object.values(CultureTopic).map((topic) => {
              const selected = value.cultureTopics.includes(topic);
              return (
                <Pressable
                  key={topic}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleTopic(topic)}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {CULTURE_TOPIC_LABEL[topic]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </FormField>
      ) : null}
      <FormField label="피촬영자 만 14세 미만 여부">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: value.hasMinorSubject }}
          style={styles.minorRow}
          onPress={() => onChange({ hasMinorSubject: !value.hasMinorSubject })}
        >
          <View style={[styles.minorBox, value.hasMinorSubject && styles.minorBoxChecked]}>
            {value.hasMinorSubject ? <Text style={styles.minorCheck}>✓</Text> : null}
          </View>
          <Text style={styles.minorLabel}>촬영본에 만 14세 미만 아동이 나옵니다</Text>
        </Pressable>
        {value.hasMinorSubject ? (
          // T-W2-36 촬영자 책임 모델(07 §3-3 개정) — 앱은 수취 여부를 판단하지 않으므로
          // 차단을 시사하는 문구를 쓰면 거짓이 된다. 리마인더만 말한다.
          <Text style={styles.minorGuide}>
            법정대리인 동의서는 촬영자가 직접 받아 보관해 주세요. 앱은 수취 여부를 확인하지
            않으며, 동의서 없이 촬영·송출된 콘텐츠의 책임은 촬영자에게 있습니다.
          </Text>
        ) : null}
      </FormField>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typo.body,
    color: colors.text,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: typo.caption, color: colors.text },
  chipLabelSelected: { color: '#FFFFFF', fontWeight: '600' },
  help: { fontSize: typo.caption, color: colors.textMuted, marginTop: spacing.xs },
  minorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  minorBox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minorBoxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  minorCheck: { color: '#FFFFFF', fontSize: typo.caption, fontWeight: '700' },
  minorLabel: { fontSize: typo.body, color: colors.text, flexShrink: 1 },
  minorGuide: {
    fontSize: typo.caption,
    color: colors.warning,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});
