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
import type { ContentStatus, ContentSummary, ProgramCategory } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { useBoardFilter } from '../../../src/board/board-filter-context';
import { formatDuration, formatRelativeTime } from '../../../src/features/contents/format';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import { useContentBoard } from '../../../src/features/contents/queries';
import { statusBadge } from '../../../src/features/contents/status';
import { useBranchStations } from '../../../src/features/stations/queries';
import type { BoardFilter } from '../../../src/query/keys';
import { Badge } from '../../../src/ui/badge';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/**
 * 상태 칩 — 서버 status는 단일 값만 받는다(status-set/IN 미지원).
 * 기본 진입은 '센터 검토 대기'로 노이즈(전 지사·draft·live_vod 포함)를 억제.
 */
const STATUS_FILTERS: readonly { label: string; status?: ContentStatus }[] = [
  { label: '검토 대기', status: 'awaiting_center_review' },
  { label: '전체' },
  { label: '처리 중', status: 'processing' },
  { label: '분석 중', status: 'analyzing' },
  { label: '프리뷰 생성', status: 'preview_generating' },
  { label: '기자 확인 대기', status: 'awaiting_reporter_review' },
  { label: '편집 실패', status: 'processing_failed' },
  { label: '송출 실패', status: 'publish_failed' },
  { label: '송출 완료', status: 'published' },
];

const CATEGORY_FILTERS: readonly ProgramCategory[] = [
  'news',
  'politics_talk',
  'culture',
  'local_weather',
  'live_commerce',
  'emergency',
];

function SkeletonCard(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

/** ② 검토 보드 — 12개 지사 전체(무필터) 최신순 카드 리스트 (센터의 홈) */
export default function BoardScreen(): React.JSX.Element {
  const { stationId, setStationId } = useBoardFilter();
  const [statusIndex, setStatusIndex] = useState(0);
  const [category, setCategory] = useState<ProgramCategory | undefined>(undefined);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const stations = useBranchStations();

  const filter = useMemo<BoardFilter>(() => {
    const status = STATUS_FILTERS[statusIndex]?.status;
    return {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(stationId ? { stationId } : {}),
    };
  }, [statusIndex, category, stationId]);

  const list = useContentBoard(filter);

  // offset 페이지네이션이라 목록 변동 시 같은 항목이 페이지 경계에 중복 등장할 수 있다 → id 기준 dedupe
  const items = useMemo(() => {
    const byId = new Map<string, ContentSummary>();
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [list.data]);

  const selectedStationName = stationId
    ? stations.data?.items.find((s) => s.id === stationId)?.name
    : undefined;

  const renderCard = ({ item }: { item: ContentSummary }): React.JSX.Element => {
    const badge = statusBadge(item.status);
    const needsAction = Boolean(badge.needsCenterAction);
    return (
      <Pressable
        style={[styles.card, needsAction && styles.cardHighlight]}
        onPress={() => router.push(`/contents/${item.id}`)}
      >
        <View style={styles.cardTop}>
          <View style={styles.thumb}>
            <Text style={styles.thumbLabel}>{CATEGORY_LABEL[item.category]}</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={styles.badgeRow}>
              <Badge label={badge.label} tone={badge.tone} />
              {needsAction ? <Text style={styles.actionLabel}>확인 필요</Text> : null}
            </View>
            <Text style={styles.cardMeta}>
              {CATEGORY_LABEL[item.category]} · {formatDuration(item.durationSec)} ·{' '}
              {formatRelativeTime(item.createdAt)}
            </Text>
            <Text style={styles.cardMeta}>
              {item.stationName} · {item.reporterName ?? '라이브 녹화'}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      {/* 상태 칩 (단일 선택) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
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

      {/* 지사 필터 (딥링크 공유) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          style={[styles.chip, !stationId && styles.chipSelected]}
          onPress={() => setStationId(undefined)}
        >
          <Text style={[styles.chipLabel, !stationId && styles.chipLabelSelected]}>전체 지사</Text>
        </Pressable>
        {(stations.data?.items ?? []).map((s) => {
          const selected = s.id === stationId;
          return (
            <Pressable
              key={s.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setStationId(s.id)}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{s.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 카테고리 필터 (접이식·부차) */}
      <View style={styles.categoryWrap}>
        <Pressable onPress={() => setCategoryOpen((v) => !v)}>
          <Text style={styles.categoryToggle}>
            분류 {category ? `· ${CATEGORY_LABEL[category]}` : ''} {categoryOpen ? '▲' : '▼'}
          </Text>
        </Pressable>
        {categoryOpen ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Pressable
              style={[styles.chip, !category && styles.chipSelected]}
              onPress={() => setCategory(undefined)}
            >
              <Text style={[styles.chipLabel, !category && styles.chipLabelSelected]}>전체</Text>
            </Pressable>
            {CATEGORY_FILTERS.map((c) => {
              const selected = c === category;
              return (
                <Pressable
                  key={c}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {CATEGORY_LABEL[c]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {selectedStationName ? (
        <Text style={styles.filterHint}>{selectedStationName} 콘텐츠</Text>
      ) : null}

      {list.isPending ? (
        <View style={styles.listContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : list.isError ? (
        <ErrorView message={userMessageForError(list.error)} onRetry={() => void list.refetch()} />
      ) : (
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
            <RefreshControl
              refreshing={list.isRefetching && !list.isFetchingNextPage}
              onRefresh={() => void list.refetch()}
            />
          }
          ListEmptyComponent={<EmptyState message="검토할 콘텐츠가 없습니다" />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
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
  categoryWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  categoryToggle: { fontSize: typo.caption, color: colors.textMuted, fontWeight: '600' },
  filterHint: {
    fontSize: typo.caption,
    color: colors.primary,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHighlight: { borderColor: colors.warning, borderWidth: 2 },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  thumb: {
    width: 72,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbLabel: { fontSize: 11, color: colors.textMuted },
  cardBody: { flex: 1, gap: spacing.xs },
  cardTitle: { fontSize: typo.body, fontWeight: '600', color: colors.text },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionLabel: { fontSize: typo.caption, color: colors.warning, fontWeight: '700' },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
  skeletonLine: {
    height: 16,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  skeletonShort: { width: '55%' },
});
