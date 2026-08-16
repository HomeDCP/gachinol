import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { isCaptionEditableStatus, toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../../src/api/errors';
import { SceneListEditor } from '../../../../src/features/contents/components/scene-list-editor';
import { toSceneFormValues } from '../../../../src/features/contents/mappers';
import { useUpdateCaptions } from '../../../../src/features/contents/mutations';
import { useContentDetail } from '../../../../src/features/contents/queries';
import { emptySceneForm, validateScenes } from '../../../../src/features/contents/validation';
import type { SceneFormValue } from '../../../../src/features/contents/validation';
import { Button } from '../../../../src/ui/button';
import { ErrorView } from '../../../../src/ui/error-view';
import { confirmDialog } from '../../../../src/ui/feedback';
import { LoadingView } from '../../../../src/ui/loading-view';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

/**
 * 사후 자막 보강 (T-W2-34 — 대장 #123 · 정본 03 §C-4).
 *
 * 간단 모드로 올라온 영상(자막 0)과 주민 제보 영상의 자막을 **지사 담당자 누구나** 채우는 화면.
 * 초안 수정(`edit.tsx`)과 다른 점이 정확히 두 가지다:
 *  ① 담당 기자가 아니어도 된다(같은 지사면 된다 — 서버 `loadReadable`).
 *  ② `published` **직전까지** 열려 있다(초안 수정은 draft·revision_requested뿐).
 * 대신 여기서는 자막 말고 아무것도 못 고친다 — 서버 DTO에 `scenes`밖에 없다.
 *
 * 웹 편차: 이탈 확인은 `confirmDialog`(ui/feedback)를 쓴다. react-native-web의 `Alert`는
 * **빈 함수**라(대장 #92) `Alert.alert`로 확인을 받으면 웹에서 콜백이 영원히 실행되지 않는다.
 */
export default function CaptionsScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');
  const detail = useContentDetail(contentId);
  const mutation = useUpdateCaptions(contentId);
  const navigation = useNavigation();

  const [scenes, setScenes] = useState<SceneFormValue[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const content = detail.data?.content;
  const editable = content ? isCaptionEditableStatus(content.status) : false;

  // 프리필 (1회) — 자막이 없으면 빈 카드 1장으로 시작해 바로 타이핑할 수 있게 한다
  useEffect(() => {
    if (content && scenes === null) {
      const prefilled = toSceneFormValues(content.scenes);
      setScenes(prefilled.length > 0 ? prefilled : [emptySceneForm()]);
    }
  }, [content, scenes]);

  // 상태 가드 — 송출·종결 이후엔 서버가 409로 막으므로 화면에서도 먼저 돌려보낸다
  useEffect(() => {
    if (content && !editable) {
      showToast('이미 송출됐거나 종결된 콘텐츠의 자막은 수정할 수 없습니다');
      router.replace(`/contents/${contentId}`);
    }
  }, [content, editable, contentId]);

  // 이탈 확인 — 웹에서도 동작하는 confirmDialog (Alert.alert는 RNW에서 no-op)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirty || mutation.isSuccess) return;
      e.preventDefault();
      void confirmDialog({
        title: '자막 작성을 그만둘까요?',
        message: '저장하지 않은 자막은 사라집니다.',
        confirmText: '나가기',
        cancelText: '계속 작성',
        destructive: true,
      }).then((leave) => {
        if (leave) navigation.dispatch(e.data.action);
      });
    });
    return unsubscribe;
  }, [navigation, dirty, mutation.isSuccess]);

  if (detail.isPending || (content && editable && scenes === null)) {
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
  if (!content || !editable || scenes === null) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  const save = (): void => {
    const result = validateScenes(scenes);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    mutation.mutate(
      { scenes: result.value },
      {
        onSuccess: () => {
          setDirty(false);
          showToast('자막을 저장했습니다');
          router.replace(`/contents/${contentId}`);
        },
        onError: (err) => {
          if (isApiClientError(err) && err.status === 409) {
            // 상태가 바뀌어 더는 못 고친다 — 훅이 invalidate+토스트, 여기선 상세로 복귀
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
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{content.title}</Text>
          <Text style={styles.noticeBody}>
            자막만 채웁니다. 제목·분류·영상은 여기서 바꿀 수 없습니다. 담당 기자가 아니어도 같은
            지사 콘텐츠면 채울 수 있습니다.
          </Text>
        </View>
        <SceneListEditor
          scenes={scenes}
          onChange={(next) => {
            setScenes(next);
            setDirty(true);
          }}
          errors={errors}
        />
        {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}
        <Button
          label="자막 저장"
          onPress={save}
          loading={mutation.isPending}
          style={styles.save}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  notice: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  noticeTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  noticeBody: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  serverError: {
    color: colors.danger,
    fontSize: typo.caption,
    marginVertical: spacing.md,
    textAlign: 'center',
  },
  save: { marginTop: spacing.lg },
});
