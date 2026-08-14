import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import type { RecommendationStatus, WeeklyRecommendation } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { formatRelativeTime } from '../../../src/features/contents/format';
import { useGenerateRecommendation } from '../../../src/features/recommendations/mutations';
import { useRecommendationList } from '../../../src/features/recommendations/queries';
import { conflictRecommendationId } from '../../../src/features/recommendations/selectors';
import { recommendationBadge } from '../../../src/features/recommendations/status';
import {
  currentWeekOfKst,
  formatWeekLabel,
} from '../../../src/features/recommendations/week';
import type { RecommendationFilter } from '../../../src/query/keys';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { Screen } from '../../../src/ui/screen';
import { confirmDialog } from '../../../src/ui/feedback';
import { showToast } from '../../../src/ui/toast';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/** 상태 칩 — 서버 status는 단일 값만 받는다. 기본 진입은 '검토 대기'(센터 조치 대상) */
const STATUS_FILTERS: readonly { label: string; status?: RecommendationStatus }[] = [
  { label: '검토 대기', status: 'pending_review' },
  { label: '전체' },
  { label: '생성 중', status: 'generating' },
  { label: '수정 반영 중', status: 'regenerating' },
  { label: '승인됨', status: 'approved' },
  { label: '생성 실패', status: 'generation_failed' },
];

function SkeletonCard(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

/** ⑤ 주간 추천 탭 — 주차 카드 목록 + [이번 주 추천 생성]. 탭 → 검토 상세 */
export default function RecommendationsScreen(): React.JSX.Element {
  const [statusIndex, setStatusIndex] = useState(0);

  const filter = useMemo<RecommendationFilter>(() => {
    const status = STATUS_FILTERS[statusIndex]?.status;
    return status ? { status } : {};
  }, [statusIndex]);

  const list = useRecommendationList(filter);
  const generate = useGenerateRecommendation();

  // offset 페이지네이션이라 목록 변동 시 페이지 경계 중복이 가능 → id 기준 dedupe
  const items = useMemo(() => {
    const byId = new Map<string, WeeklyRecommendation>();
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [list.data]);

  /** weekOf는 앱이 KST 월요일로 계산해 보내되, 서버가 어차피 정규화한다 */
  const runGenerate = (): void => {
    generate.mutate(
      { weekOf: currentWeekOfKst() },
      {
        onSuccess: (rec) => {
          showToast('추천 생성을 시작했습니다');
          router.push(`/recommendations/${rec.id}`);
        },
        onError: (err) => {
          const existingId = conflictRecommendationId(err);
          if (existingId) {
            void confirmDialog({
              title: userMessageForError(err),
              message: '기존 주차 추천을 열어볼까요?',
              confirmText: '열기',
              cancelText: '닫기',
            }).then((open) => {
              if (open) router.push(`/recommendations/${existingId}`);
            });
            return;
          }
          showToast(userMessageForError(err));
        },
      },
    );
  };

  const renderCard = ({ item }: { item: WeeklyRecommendation }): React.JSX.Element => {
    const badge = recommendationBadge(item.status);
    const needsAction = Boolean(badge.needsCenterAction);
    return (
      <Pressable
        style={[styles.card, needsAction && styles.cardHighlight]}
        onPress={() => router.push(`/recommendations/${item.id}`)}
      >
        <View style={styles.cardTop}>
          <Badge label={badge.label} tone={badge.tone} />
          {needsAction ? <Text style={styles.actionLabel}>확인 필요</Text> : null}
        </View>
        <Text style={styles.cardTitle}>{formatWeekLabel(item.weekOf)}</Text>
        <Text style={styles.cardMeta}>
          항목 {item.items.length}건 · 산출물 v{item.generation}
        </Text>
        <Text style={styles.cardMeta}>생성 {formatRelativeTime(item.createdAt)}</Text>
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Button
          label="이번 주 추천 생성"
          onPress={runGenerate}
          loading={generate.isPending}
          disabled={generate.isPending}
        />
        <Text style={styles.headerHint}>
          해당 주차의 송출 완료 + AI 분석 콘텐츠를 추천 점수순으로 모읍니다. 주차당 1건입니다.
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {STATUS_FILTERS.map((f, index) => {
          const selected = index === statusIndex;
          return (
            <Pressable
              key={f.label}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setStatusIndex(index)}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />
        }
        ListEmptyComponent={
          list.isError ? (
            <ErrorView
              message={userMessageForError(list.error)}
              onRetry={() => void list.refetch()}
            />
          ) : list.isPending ? (
            <View style={styles.skeletonWrap}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <EmptyState
              message="아직 생성된 주간 추천이 없습니다"
              ctaLabel="이번 주 추천 생성"
              onPressCta={runGenerate}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerHint: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  // horizontal ScrollView는 부모 flex 안에서 세로로 늘거나(flexGrow) 눌린다(flexShrink).
  // 실배포에서 구독자 웹은 넓은 화면에서 칩이 잘렸고, 관제 웹은 칩이 세로로 길게 늘어났다 —
  // 같은 원인의 양방향 증상이다. `style`로 세로 크기를 콘텐츠에 고정한다(contentContainerStyle은
  // 안쪽 여백만 담당하므로 이 문제를 못 막는다).
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
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
  listContent: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    flexGrow: 1,
  },
  skeletonWrap: { gap: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHighlight: { borderColor: colors.warning, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionLabel: { fontSize: typo.caption, color: colors.warning, fontWeight: '700' },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
  skeletonLine: {
    height: 14,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
  },
  skeletonShort: { width: '55%' },
});
