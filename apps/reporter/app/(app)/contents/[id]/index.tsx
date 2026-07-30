import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { ContentId, RevisionRequest, StatusTransitionLog } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../../src/api/errors';
import { useReporter } from '../../../../src/auth/auth-context';
import { reporterActionsFor } from '../../../../src/features/contents/actions';
import { formatDateTime, formatDuration } from '../../../../src/features/contents/format';
import { CATEGORY_LABEL, CULTURE_TOPIC_LABEL } from '../../../../src/features/contents/labels';
import { useCancel, useRetry } from '../../../../src/features/contents/mutations';
import { useContentDetail, useTransitionLogs } from '../../../../src/features/contents/queries';
import {
  STATUS_BADGE,
  STATUS_DESCRIPTION,
  isTerminalStatus,
  statusBadge,
} from '../../../../src/features/contents/status';
import { ProcessingHoldBanner } from '../../../../src/features/system/components/processing-hold-banner';
import { shouldShowHoldForContent } from '../../../../src/features/system/processing-hold';
import { useProcessingState } from '../../../../src/features/system/queries';
import { Badge } from '../../../../src/ui/badge';
import { Button } from '../../../../src/ui/button';
import { ErrorView } from '../../../../src/ui/error-view';
import { LoadingView } from '../../../../src/ui/loading-view';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

function statusLabelOf(status: string): string {
  return status in STATUS_BADGE ? STATUS_BADGE[status as keyof typeof STATUS_BADGE].label : status;
}

function RevisionCard({
  revision,
  captionOf,
}: {
  revision: RevisionRequest;
  captionOf: (sceneId: string) => string | undefined;
}): React.JSX.Element {
  return (
    <View style={styles.subCard}>
      <Text style={styles.subCardTitle}>
        {revision.requesterRole === 'reporter' ? '내 요청' : '센터 지시'} ·{' '}
        {formatDateTime(revision.createdAt)}
      </Text>
      <Text style={styles.bodyText}>{revision.message}</Text>
      {revision.sceneNotes?.map((note, i) => (
        <Text key={i} style={styles.metaText}>
          — 장면 &quot;{captionOf(note.sceneId) ?? note.sceneId}&quot;: {note.note}
        </Text>
      ))}
      <Text style={styles.metaText}>
        {revision.resolvedAt ? `반영 완료 ${formatDateTime(revision.resolvedAt)}` : '반영 대기'}
      </Text>
    </View>
  );
}

function LogRow({ log }: { log: StatusTransitionLog }): React.JSX.Element {
  return (
    <View style={styles.logRow}>
      <Text style={styles.bodyText}>
        {statusLabelOf(log.fromStatus)} → {statusLabelOf(log.toStatus)}
      </Text>
      <Text style={styles.metaText}>
        {log.actorType === 'system' ? '자동' : '담당자'} · {formatDateTime(log.at)}
        {log.note ? ` · ${log.note}` : ''}
      </Text>
    </View>
  );
}

/** ④ 상세 — 상태·이력·수정요청 + 액션 바 */
export default function ContentDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');
  const me = useReporter();

  // 폴링은 화면 포커스 시에만
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const detail = useContentDetail(contentId, { poll: focused });
  const processing = useProcessingState();
  const logs = useTransitionLogs(contentId);
  const cancel = useCancel(contentId);
  const retry = useRetry(contentId);

  const [logsOpen, setLogsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  if (detail.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (detail.isError) {
    const err = detail.error;
    const notFound = isApiClientError(err) && err.status === 404;
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(err)}
          retryLabel={notFound ? '목록으로' : '다시 시도'}
          onRetry={() => (notFound ? router.replace('/') : void detail.refetch())}
        />
      </Screen>
    );
  }

  const { content, revisions } = detail.data;
  const badge = statusBadge(content.status);
  const actions = reporterActionsFor(content, me.id);
  const captionOf = (sceneId: string): string | undefined =>
    content.scenes.find((s) => s.id === sceneId)?.caption;
  const logItems = logs.data?.pages.flatMap((p) => p.items) ?? [];
  const hasAnyAction =
    actions.canReview ||
    actions.canEdit ||
    actions.canStartMockUpload ||
    actions.canRetryUpload ||
    actions.canCancel;

  const submitCancel = (): void => {
    const note = cancelNote.trim();
    if (note.length > 2000) {
      // 원천: content.schemas.ts zCancelContent — note max(2000) opt
      showToast('취소 사유는 2000자 이내로 입력해 주세요');
      return;
    }
    // 모달은 성공 시에만 닫는다 — 전송 전에 닫으면 실패 시 입력한 사유가 유실된다
    cancel.mutate(note ? { note } : {}, {
      onSuccess: () => {
        setCancelOpen(false);
        setCancelNote('');
        showToast('취소되었습니다');
      },
      onError: (err) => {
        if (isApiClientError(err) && err.status === 409) {
          // 상태 경합 — mutations 훅이 invalidate+토스트, 모달만 닫는다
          setCancelOpen(false);
          return;
        }
        showToast(userMessageForError(err));
      },
    });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {/* (a) 상태 카드 */}
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Badge label={badge.label} tone={badge.tone} />
            {content.priority === 'urgent' ? <Badge label="긴급" tone="danger" /> : null}
          </View>
          <Text style={styles.bodyText}>{STATUS_DESCRIPTION[content.status]}</Text>
          {/* 큐 대기 상태인데 처리 게이트가 정지 중이면 — 실패가 아니라 대기임을 분명히 한다 */}
          {shouldShowHoldForContent(processing.data, content.status) ? (
            <ProcessingHoldBanner state={processing.data!} />
          ) : null}
          {content.lastError ? (
            <Text style={styles.errorText}>
              {content.lastError.message} ({formatDateTime(content.lastError.at)})
            </Text>
          ) : null}
          <Text style={styles.metaText}>산출물 v{content.generation}</Text>
          <Text style={styles.metaText}>
            {content.reviewPolicy === 'reporter_then_center'
              ? '검토 정책: 기자 승인 후 센터 검토'
              : '검토 정책: 기자 승인만으로 송출'}
          </Text>
          {content.publishedAt ? (
            <Text style={styles.metaText}>송출 완료 {formatDateTime(content.publishedAt)}</Text>
          ) : null}
        </View>

        {/* (b) 기본 정보 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{content.title}</Text>
          <Text style={styles.metaText}>
            {CATEGORY_LABEL[content.category]}
            {content.cultureTopics?.length
              ? ` · ${content.cultureTopics.map((t) => CULTURE_TOPIC_LABEL[t]).join(', ')}`
              : ''}
            {' · '}
            {formatDuration(content.durationSec)}
          </Text>
          {content.description ? <Text style={styles.bodyText}>{content.description}</Text> : null}
        </View>

        {/* (c) 장면 목록 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>장면 ({content.scenes.length})</Text>
          {content.scenes.length === 0 ? (
            <Text style={styles.metaText}>장면이 없습니다.</Text>
          ) : (
            [...content.scenes]
              .sort((a, b) => a.order - b.order)
              .map((scene) => (
                <View key={scene.id} style={styles.subCard}>
                  <Text style={styles.bodyText}>
                    {scene.order + 1}. {scene.caption}
                  </Text>
                  <Text style={styles.metaText}>
                    {scene.startSec !== null && scene.endSec !== null
                      ? `${scene.startSec}초 ~ ${scene.endSec}초`
                      : '구간 미정'}
                  </Text>
                </View>
              ))
          )}
        </View>

        {/* (d) 수정요청 (최신순) */}
        {revisions.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>수정 요청</Text>
            {revisions.map((rev) => (
              <RevisionCard key={rev.id} revision={rev} captionOf={captionOf} />
            ))}
          </View>
        ) : null}

        {/* (e) 이력 (접이식) */}
        <View style={styles.card}>
          <Pressable onPress={() => setLogsOpen((v) => !v)}>
            <Text style={styles.sectionTitle}>이력 {logsOpen ? '▲' : '▼'}</Text>
          </Pressable>
          {logsOpen ? (
            <>
              {logItems.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
              {logs.hasNextPage ? (
                <Button
                  label="더 보기"
                  variant="secondary"
                  loading={logs.isFetchingNextPage}
                  onPress={() => void logs.fetchNextPage()}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* 하단 액션 바 — reporterActionsFor 결과로만 렌더 */}
      <View style={styles.actionBar}>
        {actions.canReview ? (
          <Button
            label="프리뷰 확인하기"
            onPress={() => router.push(`/contents/${contentId}/preview`)}
          />
        ) : null}
        {actions.canEdit ? (
          <Button
            label="초안 수정"
            variant="secondary"
            onPress={() => router.push(`/contents/${contentId}/edit`)}
          />
        ) : null}
        {actions.canStartMockUpload ? (
          <Button
            label="업로드 시작"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/contents/new/upload', params: { id: contentId } })
            }
          />
        ) : null}
        {actions.canRetryUpload ? (
          <Button
            label="업로드 재시도"
            loading={retry.isPending}
            onPress={() =>
              retry.mutate(undefined, {
                onError: (err) => {
                  if (!(isApiClientError(err) && err.status === 409)) {
                    showToast(userMessageForError(err));
                  }
                },
              })
            }
          />
        ) : null}
        {actions.canCancel ? (
          <Button
            label="취소"
            variant="destructive"
            loading={cancel.isPending}
            onPress={() => setCancelOpen(true)}
          />
        ) : null}
        {!hasAnyAction && !isTerminalStatus(content.status) ? (
          <Text style={styles.metaText}>지금은 대기 단계입니다.</Text>
        ) : null}
      </View>

      {/* 취소 사유 다이얼로그 — RN Modal은 iOS에서 키보드를 회피하지 않으므로 KAV로 감싼다 */}
      <Modal visible={cancelOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>콘텐츠를 취소할까요?</Text>
            <Text style={styles.metaText}>취소는 되돌릴 수 없습니다. (사유는 선택)</Text>
            <TextInput
              style={styles.modalInput}
              value={cancelNote}
              onChangeText={setCancelNote}
              placeholder="취소 사유 (선택)"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <Button
              label="취소 확정"
              variant="destructive"
              onPress={submitCancel}
              loading={cancel.isPending}
            />
            <Button
              label="닫기"
              variant="secondary"
              onPress={() => setCancelOpen(false)}
              disabled={cancel.isPending}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', gap: spacing.sm },
  cardTitle: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  sectionTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  bodyText: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  metaText: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  errorText: { fontSize: typo.caption, color: colors.danger, lineHeight: 18 },
  subCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  subCardTitle: { fontSize: typo.caption, fontWeight: '700', color: colors.textMuted },
  logRow: { paddingVertical: spacing.sm, gap: spacing.xs },
  actionBar: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    padding: spacing.md,
    minHeight: 72,
    textAlignVertical: 'top',
    fontSize: typo.body,
    color: colors.text,
  },
});
