import { useCallback, useState } from 'react';
import {
  Alert,
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
import type { ContentSummary, RecommendationItem, WeeklyRecommendationId } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../src/api/errors';
import { formatDateTime, formatDuration } from '../../../src/features/contents/format';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import {
  useApproveRecommendation,
  useGenerateRecommendation,
  useRequestRecommendationRevision,
} from '../../../src/features/recommendations/mutations';
import { useRecommendationReview } from '../../../src/features/recommendations/queries';
import {
  formatScore,
  isRegenerated,
  itemCountLabel,
  missingItemCount,
  sortedReviewItems,
} from '../../../src/features/recommendations/selectors';
import {
  RECOMMENDATION_DESCRIPTION,
  isAutoProgressRecommendationStatus,
  recommendationActionsFor,
  recommendationBadge,
} from '../../../src/features/recommendations/status';
import { validateRecommendationRevisionNote } from '../../../src/features/recommendations/validation';
import { formatWeekLabel } from '../../../src/features/recommendations/week';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { ErrorView } from '../../../src/ui/error-view';
import { LoadingView } from '../../../src/ui/loading-view';
import { Screen } from '../../../src/ui/screen';
import { showToast } from '../../../src/ui/toast';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/** 추천 항목 1건 — 탭하면 콘텐츠 검토 상세로 크로스 딥링크 */
function ItemRow({
  item,
  content,
}: {
  item: RecommendationItem;
  content: ContentSummary;
}): React.JSX.Element {
  return (
    <Pressable style={styles.itemCard} onPress={() => router.push(`/contents/${content.id}`)}>
      <View style={styles.itemHeader}>
        <Text style={styles.rank}>#{item.rank}</Text>
        <Text style={styles.score}>점수 {formatScore(item.score)}</Text>
      </View>
      <Text style={styles.itemTitle} numberOfLines={2}>
        {content.title}
      </Text>
      <Text style={styles.metaText}>
        {content.stationName} · {content.reporterName ?? '라이브 녹화'} ·{' '}
        {CATEGORY_LABEL[content.category]} · {formatDuration(content.durationSec)}
      </Text>
      <Text style={styles.bodyText}>{item.reason}</Text>
    </Pressable>
  );
}

/** ⑤ 주간 추천 검토 상세 — 총평 + 순위 항목 + 승인/수정요청 */
export default function RecommendationDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recommendationId = toId<WeeklyRecommendationId>(id ?? '');

  // 폴링은 화면 포커스 시에만
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const review = useRecommendationReview(recommendationId, { poll: focused });
  const approve = useApproveRecommendation(recommendationId);
  const requestRevision = useRequestRecommendationRevision(recommendationId);
  const generate = useGenerateRecommendation();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>(undefined);

  if (review.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (review.isError) {
    const err = review.error;
    const notFound = isApiClientError(err) && err.status === 404;
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(err)}
          retryLabel={notFound ? '목록으로' : '다시 시도'}
          onRetry={() =>
            notFound ? router.replace('/recommendations') : void review.refetch()
          }
        />
      </Screen>
    );
  }

  const { recommendation } = review.data;
  const badge = recommendationBadge(recommendation.status);
  const actions = recommendationActionsFor(recommendation);
  const items = sortedReviewItems(review.data);
  const missing = missingItemCount(review.data);
  const inProgress = isAutoProgressRecommendationStatus(recommendation.status);
  const anyPending = approve.isPending || requestRevision.isPending;

  const onTransitionError = (err: unknown): void => {
    if (isApiClientError(err) && err.status === 409) {
      // 상태 경합 — mutations 훅이 invalidate+토스트, 시트만 닫는다
      setSheetOpen(false);
      return;
    }
    showToast(userMessageForError(err));
  };

  const confirmApprove = (): void => {
    Alert.alert(
      '승인할까요?',
      '승인하면 이 주차 추천이 확정됩니다. (송출 배선은 후속 — 자동 송출되지 않습니다)',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '승인',
          onPress: () =>
            approve.mutate(undefined, {
              onSuccess: () => showToast('주간 추천을 승인했습니다'),
              onError: onTransitionError,
            }),
        },
      ],
    );
  };

  /** 생성 실패 재시도 = 같은 주차로 POST /v1/recommendations 재호출 */
  const confirmRetry = (): void => {
    Alert.alert('다시 생성할까요?', '해당 주차의 추천을 처음부터 다시 만듭니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '다시 생성',
        onPress: () =>
          generate.mutate(
            { weekOf: recommendation.weekOf },
            {
              onSuccess: () => showToast('추천 생성을 다시 시작했습니다'),
              onError: (err) => {
                if (!(isApiClientError(err) && err.status === 409)) {
                  showToast(userMessageForError(err));
                }
              },
            },
          ),
      },
    ]);
  };

  const openSheet = (): void => {
    setNote('');
    setNoteError(undefined);
    setSheetOpen(true);
  };

  const submitRevision = (): void => {
    const result = validateRecommendationRevisionNote(note);
    if (!result.ok) {
      setNoteError(result.errors.note);
      return;
    }
    setNoteError(undefined);
    requestRevision.mutate(
      { note: result.value },
      {
        onSuccess: () => {
          setSheetOpen(false);
          showToast('수정 요청을 보냈습니다. 반영해 다시 생성합니다.');
        },
        onError: onTransitionError,
      },
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {/* (a) 상태 카드 */}
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Badge label={badge.label} tone={badge.tone} />
            {isRegenerated(recommendation) ? (
              <Text style={styles.actionLabel}>수정 반영본</Text>
            ) : null}
          </View>
          <Text style={styles.cardTitle}>{formatWeekLabel(recommendation.weekOf)}</Text>
          <Text style={styles.bodyText}>{RECOMMENDATION_DESCRIPTION[recommendation.status]}</Text>
          <Text style={styles.metaText}>산출물 v{recommendation.generation}</Text>
          {inProgress ? (
            <Text style={styles.metaText}>생성 중… 완료되면 자동으로 갱신됩니다.</Text>
          ) : null}
          {recommendation.approvedAt ? (
            <Text style={styles.metaText}>승인 {formatDateTime(recommendation.approvedAt)}</Text>
          ) : null}
        </View>

        {/* (b) 총평 — 재생성이면 수정 지시 접두가 여기 노출된다 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>총평</Text>
          {recommendation.summary ? (
            <Text style={styles.bodyText}>{recommendation.summary}</Text>
          ) : (
            <Text style={styles.metaText}>총평이 아직 없습니다.</Text>
          )}
        </View>

        {/* (c) 추천 항목 (rank 오름차순) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>추천 항목 ({itemCountLabel(review.data)})</Text>
          {missing > 0 ? (
            <Text style={styles.warningText}>
              콘텐츠 {missing}건이 삭제되어 표시할 수 없습니다.
            </Text>
          ) : null}
          {items.length === 0 ? (
            <Text style={styles.metaText}>
              {inProgress ? '생성이 끝나면 항목이 표시됩니다.' : '표시할 항목이 없습니다.'}
            </Text>
          ) : (
            items.map(({ item, content }) => (
              <ItemRow key={item.contentId} item={item} content={content} />
            ))
          )}
        </View>
      </ScrollView>

      {/* 하단 결정 액션 바 — recommendationActionsFor 결과로만 렌더 */}
      <View style={styles.actionBar}>
        {actions.canDecide ? (
          <>
            <Button
              label="승인"
              onPress={confirmApprove}
              loading={approve.isPending}
              disabled={anyPending}
            />
            <Button
              label="수정 요청"
              variant="secondary"
              onPress={openSheet}
              loading={requestRevision.isPending}
              disabled={anyPending}
            />
          </>
        ) : actions.canRetryGeneration ? (
          <Button label="다시 생성" onPress={confirmRetry} loading={generate.isPending} />
        ) : (
          <Text style={styles.metaText}>
            {inProgress ? '생성이 끝나면 결정할 수 있습니다.' : '지금은 결정 단계가 아닙니다.'}
          </Text>
        )}
      </View>

      {/* 수정 요청 하단 시트 */}
      <Modal visible={sheetOpen} transparent animationType="slide">
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
              <Text style={styles.sectionTitle}>수정 요청</Text>
              <Text style={styles.metaText}>
                요청을 보내면 이 주차 추천을 최신 데이터로 다시 만듭니다(v
                {recommendation.generation + 1}). 지시 내용은 총평 앞머리에 남습니다.
              </Text>
              <TextInput
                style={styles.sheetInput}
                value={note}
                onChangeText={setNote}
                placeholder="수정 요청 내용 (필수)"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
              />
              {noteError ? <Text style={styles.errorText}>{noteError}</Text> : null}
            </ScrollView>
            <Button
              label="수정 요청 보내기"
              onPress={submitRevision}
              loading={requestRevision.isPending}
              disabled={anyPending}
            />
            <Button
              label="닫기"
              variant="secondary"
              onPress={() => setSheetOpen(false)}
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionLabel: { fontSize: typo.caption, color: colors.warning, fontWeight: '700' },
  cardTitle: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  sectionTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  bodyText: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  metaText: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  warningText: { fontSize: typo.caption, color: colors.warning, lineHeight: 18 },
  errorText: { fontSize: typo.caption, color: colors.danger, lineHeight: 18 },
  itemCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rank: { fontSize: typo.body, fontWeight: '700', color: colors.primary },
  score: { fontSize: typo.caption, color: colors.textMuted },
  itemTitle: { fontSize: typo.body, fontWeight: '600', color: colors.text },
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
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { gap: spacing.md },
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
});
