import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { toId } from '@gachinol/shared';
import type { ContentId, SceneId } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../../src/api/errors';
import { useReporter } from '../../../../src/auth/auth-context';
import { formatDateTime } from '../../../../src/features/contents/format';
import {
  useApprove,
  useReject,
  useRequestRevision,
} from '../../../../src/features/contents/mutations';
import { useContentDetail } from '../../../../src/features/contents/queries';
import { STATUS_BADGE } from '../../../../src/features/contents/status';
import {
  validateRejectNote,
  validateRevisionNote,
} from '../../../../src/features/contents/validation';
import { Button } from '../../../../src/ui/button';
import { ErrorView } from '../../../../src/ui/error-view';
import { LoadingView } from '../../../../src/ui/loading-view';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

/**
 * 프리뷰 플레이어 격리 — URL만 오면 재생되도록 배선 완성.
 * TODO(media): GET /v1/media-assets/:id/url (shared MediaAccessUrl) 도입 시 소스 연결
 */
function PreviewPlayer({ sourceUrl }: { sourceUrl: string | null }): React.JSX.Element {
  const player = useVideoPlayer(sourceUrl);
  if (!sourceUrl) {
    return (
      <View style={styles.playerPlaceholder}>
        <Text style={styles.placeholderText}>
          저화질 프리뷰 준비 중 — 미디어 파이프라인 연동 후 재생됩니다
        </Text>
      </View>
    );
  }
  return <VideoView player={player} style={styles.player} />;
}

type SheetKind = 'revision' | 'reject' | null;

/** ⑤ 프리뷰 확인·승인 — awaiting_reporter_review + 담당 기자 전용 */
export default function PreviewScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');
  const me = useReporter();
  const detail = useContentDetail(contentId);
  const approve = useApprove(contentId);
  const requestRevision = useRequestRevision(contentId);
  const reject = useReject(contentId);

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [note, setNote] = useState('');
  const [sceneNotes, setSceneNotes] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | undefined>(undefined);

  const content = detail.data?.content;
  const reviewable =
    content && content.status === 'awaiting_reporter_review' && content.reporterId === me.id;

  // 진입 가드 — 폴링·뒤늦은 진입 대비 (상태가 바뀌면 상세로 replace + 토스트)
  useEffect(() => {
    if (content && !reviewable) {
      showToast('확인 가능한 상태가 아닙니다');
      router.replace(`/contents/${contentId}`);
    }
  }, [content, reviewable, contentId]);

  if (detail.isPending) {
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
  if (!content || !reviewable) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  // 현 세대 ready 프리뷰 자산 — phase-1은 항상 부재 (assets 빈 배열)
  const previewAsset = detail.data.assets.find(
    (a) => a.kind === 'preview' && a.generation === content.generation && a.status === 'ready',
  );
  // TODO(media): GET /v1/media-assets/:id/url (shared MediaAccessUrl) 도입 시
  // previewAsset.id로 서명 URL을 발급받아 전달 — 배선은 완성돼 URL만 오면 재생된다.
  const previewSourceUrl: string | null = previewAsset ? null : null;
  const revisions = detail.data.revisions;
  const anyPending = approve.isPending || requestRevision.isPending || reject.isPending;

  const finish = (nextStatusLabel?: string): void => {
    if (nextStatusLabel) showToast(nextStatusLabel);
    router.replace(`/contents/${contentId}`);
  };

  const onTransitionError = (err: unknown): void => {
    if (isApiClientError(err) && err.status === 409) {
      // 상태 경합 — mutations 훅이 invalidate+토스트, 상세로 복귀
      router.replace(`/contents/${contentId}`);
      return;
    }
    showToast(userMessageForError(err));
  };

  const confirmApprove = (): void => {
    // 다이얼로그 문구는 reviewPolicy 분기
    const message =
      content.reviewPolicy === 'reporter_then_center'
        ? '승인하면 센터 검토로 넘어갑니다.'
        : '승인하면 곧바로 송출 단계로 넘어갑니다.';
    Alert.alert('승인할까요?', message, [
      { text: '취소', style: 'cancel' },
      {
        text: '승인',
        onPress: () =>
          approve.mutate(undefined, {
            // 자동 연쇄 결과 상태 그대로 표시
            onSuccess: (c) => finish(`승인 완료 — ${STATUS_BADGE[c.status].label}`),
            onError: onTransitionError,
          }),
      },
    ]);
  };

  const submitRevision = (): void => {
    const result = validateRevisionNote(note);
    if (!result.ok) {
      setNoteError(result.errors.note);
      return;
    }
    // sceneId는 detail.content.scenes의 id — 각 노트 1..1000 (zCreateRevisionRequestBody)
    const notes = Object.entries(sceneNotes)
      .map(([sceneId, sceneNote]) => ({ sceneId: toId<SceneId>(sceneId), note: sceneNote.trim() }))
      .filter((n) => n.note.length > 0);
    const tooLong = notes.find((n) => n.note.length > 1000);
    if (tooLong) {
      setNoteError('장면 노트는 각 1000자 이내로 입력해 주세요');
      return;
    }
    setNoteError(undefined);
    // 시트는 성공 시에만 닫는다 — 전송 전에 닫으면 네트워크 실패 시 입력 원문이 유실된다
    requestRevision.mutate(
      { note: result.value, ...(notes.length > 0 ? { sceneNotes: notes } : {}) },
      {
        onSuccess: () => {
          setSheet(null);
          finish('수정 요청이 접수되었습니다. 반영 후 다시 확인 요청이 옵니다.');
        },
        onError: onTransitionError,
      },
    );
  };

  const submitReject = (): void => {
    const result = validateRejectNote(note);
    if (!result.ok) {
      setNoteError(result.errors.note);
      return;
    }
    setNoteError(undefined);
    // 시트는 성공 시에만 닫는다 — 전송 전에 닫으면 네트워크 실패 시 입력 원문이 유실된다
    reject.mutate(
      { note: result.value },
      {
        onSuccess: () => {
          setSheet(null);
          finish('반려 처리되었습니다');
        },
        onError: onTransitionError,
      },
    );
  };

  const openSheet = (kind: Exclude<SheetKind, null>): void => {
    setNote('');
    setSceneNotes({});
    setNoteError(undefined);
    setSheet(kind);
  };

  const orderedScenes = [...content.scenes].sort((a, b) => a.order - b.order);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <PreviewPlayer sourceUrl={previewSourceUrl} />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>장면 자막 대조</Text>
          {orderedScenes.map((scene) => (
            <View key={scene.id} style={styles.sceneRow}>
              <Text style={styles.bodyText}>
                {scene.order + 1}. {scene.caption}
              </Text>
              {scene.startSec !== null && scene.endSec !== null ? (
                <Text style={styles.metaText}>
                  {scene.startSec}초 ~ {scene.endSec}초
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {revisions.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>수정 요청 이력</Text>
            {revisions.map((rev) => (
              <Text key={rev.id} style={styles.metaText}>
                {rev.requesterRole === 'reporter' ? '내 요청' : '센터 지시'} ·{' '}
                {formatDateTime(rev.createdAt)} — {rev.message}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actionBar}>
        <Button
          label="승인"
          onPress={confirmApprove}
          loading={approve.isPending}
          disabled={anyPending}
        />
        <Button
          label="수정 요청"
          variant="secondary"
          onPress={() => openSheet('revision')}
          loading={requestRevision.isPending}
          disabled={anyPending}
        />
        <Button
          label="반려"
          variant="destructive"
          onPress={() => openSheet('reject')}
          loading={reject.isPending}
          disabled={anyPending}
        />
      </View>

      {/* 수정 요청 / 반려 하단 시트 — RN Modal은 iOS에서 키보드를 회피하지 않으므로
          KeyboardAvoidingView로 감싸고, 본문은 ScrollView(버튼은 바깥 고정)로 구성 */}
      <Modal visible={sheet !== null} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {sheet === 'reject' ? (
                <>
                  <Text style={styles.sectionTitle}>반려</Text>
                  <Text style={styles.warningText}>
                    반려는 되돌릴 수 없습니다. 재작업은 새 콘텐츠로 진행됩니다.
                  </Text>
                </>
              ) : (
                <Text style={styles.sectionTitle}>수정 요청</Text>
              )}
              <TextInput
                style={styles.sheetInput}
                value={note}
                onChangeText={setNote}
                placeholder={sheet === 'reject' ? '반려 사유 (필수)' : '수정 요청 내용 (필수)'}
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
              />
              {sheet === 'revision'
                ? orderedScenes.map((scene) => (
                    <View key={scene.id} style={styles.sceneNoteRow}>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {scene.order + 1}. {scene.caption}
                      </Text>
                      <TextInput
                        style={styles.sceneNoteInput}
                        value={sceneNotes[scene.id] ?? ''}
                        onChangeText={(v) => setSceneNotes((prev) => ({ ...prev, [scene.id]: v }))}
                        placeholder="장면별 노트 (선택)"
                        placeholderTextColor={colors.textMuted}
                        maxLength={1000}
                      />
                    </View>
                  ))
                : null}
              {noteError ? <Text style={styles.errorText}>{noteError}</Text> : null}
            </ScrollView>
            {sheet === 'reject' ? (
              <Button
                label="반려 확정"
                variant="destructive"
                onPress={submitReject}
                loading={reject.isPending}
                disabled={anyPending}
              />
            ) : (
              <Button
                label="수정 요청 보내기"
                onPress={submitRevision}
                loading={requestRevision.isPending}
                disabled={anyPending}
              />
            )}
            <Button
              label="닫기"
              variant="secondary"
              onPress={() => setSheet(null)}
              disabled={anyPending}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  player: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md },
  playerPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.md,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  placeholderText: {
    color: '#FFFFFF',
    fontSize: typo.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  bodyText: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  metaText: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  warningText: { fontSize: typo.caption, color: colors.danger, lineHeight: 18 },
  errorText: { fontSize: typo.caption, color: colors.danger },
  sceneRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  actionBar: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '80%',
  },
  sheetInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    padding: spacing.md,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: typo.body,
    color: colors.text,
  },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { gap: spacing.md },
  sceneNoteRow: { gap: spacing.xs },
  sceneNoteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typo.caption,
    color: colors.text,
  },
});
