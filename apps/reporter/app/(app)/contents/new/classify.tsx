import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { userMessageForError } from '../../../../src/api/errors';
import { ClassifyFields } from '../../../../src/features/contents/components/classify-fields';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { useCreateDraft } from '../../../../src/features/contents/mutations';
import { validateCreateDraft } from '../../../../src/features/contents/validation';
import { Button } from '../../../../src/ui/button';
import { Screen } from '../../../../src/ui/screen';
import { colors, spacing, typo } from '../../../../src/ui/theme';

/** ③-3 분류·제목 → 초안 저장 (실 API) */
export default function ClassifyScreen(): React.JSX.Element {
  const { media, scenes, classify, updateClassify, markSaved, savedContentId } = useDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const createDraft = useCreateDraft();

  const save = (): void => {
    if (savedContentId) {
      // 이미 저장 성공한 초안 — 재저장(중복 생성) 금지, 다음 단계로 이동만
      if (media) {
        router.replace({ pathname: '/contents/new/upload', params: { id: savedContentId } });
      } else {
        router.replace(`/contents/${savedContentId}`);
      }
      return;
    }
    const result = validateCreateDraft(classify, scenes);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    createDraft.mutate(result.value, {
      onSuccess: (content) => {
        markSaved(content.id);
        if (media) {
          router.replace({ pathname: '/contents/new/upload', params: { id: content.id } });
        } else {
          router.replace(`/contents/${content.id}`);
        }
      },
      onError: (err) => setServerError(userMessageForError(err)),
    });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <ClassifyFields value={classify} onChange={updateClassify} errors={errors} />
        {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}
        <Button label="초안 저장" onPress={save} loading={createDraft.isPending} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  serverError: {
    color: colors.danger,
    fontSize: typo.caption,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
