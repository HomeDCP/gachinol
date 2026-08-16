import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../../src/api/errors';
import { useReporter } from '../../../../src/auth/auth-context';
import { ClassifyFields } from '../../../../src/features/contents/components/classify-fields';
import { SceneListEditor } from '../../../../src/features/contents/components/scene-list-editor';
import { toClassifyFormValue, toSceneFormValues } from '../../../../src/features/contents/mappers';
import { UploadMode } from '../../../../src/features/contents/mode';
import { useUpdateDraft } from '../../../../src/features/contents/mutations';
import { useContentDetail } from '../../../../src/features/contents/queries';
import { validateCreateDraft } from '../../../../src/features/contents/validation';
import type {
  ClassifyFormValue,
  SceneFormValue,
} from '../../../../src/features/contents/validation';
import { Button } from '../../../../src/ui/button';
import { ErrorView } from '../../../../src/ui/error-view';
import { LoadingView } from '../../../../src/ui/loading-view';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

/** 초안 수정 — draft·revision_requested + 담당 기자만 (위반 시 상세로 replace) */
export default function EditDraftScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');
  const me = useReporter();
  const detail = useContentDetail(contentId);
  const updateDraft = useUpdateDraft(contentId);

  const [form, setForm] = useState<{
    classify: ClassifyFormValue;
    scenes: SceneFormValue[];
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const content = detail.data?.content;
  const editable =
    content &&
    (content.status === 'draft' || content.status === 'revision_requested') &&
    content.reporterId === me.id;

  // 프리필 (1회) — mappers가 id·thumbnailUrl 제거
  useEffect(() => {
    if (content && form === null && editable) {
      setForm({
        classify: toClassifyFormValue(content),
        scenes: toSceneFormValues(content.scenes),
      });
    }
  }, [content, form, editable]);

  // 가드: 수정 불가 상태·비담당 → 상세로 replace + 토스트
  useEffect(() => {
    if (content && !editable) {
      showToast('지금은 수정할 수 없는 상태입니다');
      router.replace(`/contents/${contentId}`);
    }
  }, [content, editable, contentId]);

  if (detail.isPending || (content && editable && form === null)) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  if (!content || !editable || form === null) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  // 최신 미해소 수정요청 note 상단 고정 (revision_requested 진입 시)
  const pendingRevision =
    content.status === 'revision_requested'
      ? detail.data.revisions.find((r) => r.resolvedAt === null)
      : undefined;

  const save = (): void => {
    // 수치 규칙은 생성과 동일 — validateCreateDraft 재사용.
    // 모드는 항상 `precise`다(T-W2-34): 이 화면은 장면 편집기를 **띄워 두고 있으므로** 화면에
    // 있는 것을 그대로 검증해야 한다(간단 모드로 넘기면 사용자가 입력한 자막이 조용히 버려진다).
    // 자막을 비운 채로 두려면 이 화면이 아니라 자막 보강 화면(/contents/:id/captions)을 쓴다.
    const result = validateCreateDraft(form.classify, form.scenes, UploadMode.Precise);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    const { title, description, category, cultureTopics, scenes } = result.value;
    // PATCH: scenes 전체 배열 전송, id 미전송 (서버가 order 기준 SceneId 보존 병합)
    // cultureTopics는 비culture여도 명시적으로 빈 배열 전송 — 기존 값 잔존 방지
    // description도 항상 전송 — validateClassify는 빈 값을 키 생략하는데, PATCH에서
    // 키 생략='변경 없음'이라 지운 설명이 되살아난다 (서버 zod는 '' 허용, 렌더는 ''를 부재로 취급)
    updateDraft.mutate(
      {
        title,
        description: description ?? '',
        category,
        cultureTopics: cultureTopics ?? [],
        scenes,
      },
      {
        onSuccess: () => {
          showToast('저장되었습니다');
          router.replace(`/contents/${contentId}`);
        },
        onError: (err) => {
          if (isApiClientError(err) && err.status === 409) {
            // 상태 경합 — 상세 복귀 (mutations 훅이 invalidate+토스트 처리)
            router.replace(`/contents/${contentId}`);
            return;
          }
          setServerError(userMessageForError(err));
        },
      },
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {pendingRevision ? (
          <View style={styles.revisionBanner}>
            <Text style={styles.revisionTitle}>
              {pendingRevision.requesterRole === 'reporter' ? '내 수정 요청' : '센터 수정 지시'}
            </Text>
            <Text style={styles.revisionBody}>{pendingRevision.message}</Text>
          </View>
        ) : null}
        <Text style={styles.notice}>
          영상 교체는 업로드 API 연동 후 지원됩니다 — 여기서는 자막·분류·구간만 수정합니다.
        </Text>
        <ClassifyFields
          value={form.classify}
          onChange={(patch) =>
            setForm((prev) => {
              if (!prev) return prev;
              const nextClassify = { ...prev.classify, ...patch };
              if (patch.category !== undefined && patch.category !== 'culture') {
                nextClassify.cultureTopics = [];
              }
              return { ...prev, classify: nextClassify };
            })
          }
          errors={errors}
        />
        <SceneListEditor
          scenes={form.scenes}
          onChange={(scenes) => setForm((prev) => (prev ? { ...prev, scenes } : prev))}
          errors={errors}
        />
        {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}
        <Button label="저장" onPress={save} loading={updateDraft.isPending} style={styles.save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  revisionBanner: {
    backgroundColor: '#FBEEDC',
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  revisionTitle: { fontSize: typo.caption, fontWeight: '700', color: colors.warning },
  revisionBody: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  notice: { fontSize: typo.caption, color: colors.textMuted, marginBottom: spacing.lg },
  serverError: {
    color: colors.danger,
    fontSize: typo.caption,
    marginVertical: spacing.md,
    textAlign: 'center',
  },
  save: { marginTop: spacing.lg },
});
