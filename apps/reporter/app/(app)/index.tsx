import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import type { ContentStatus, ContentSummary } from '@gachinol/shared';
import { userMessageForError } from '../../src/api/errors';
import { useReporter, useSession } from '../../src/auth/auth-context';
import { formatDuration, formatRelativeTime } from '../../src/features/contents/format';
import { CATEGORY_LABEL } from '../../src/features/contents/labels';
import { useContentList, useStation } from '../../src/features/contents/queries';
import { statusBadge } from '../../src/features/contents/status';
import { Badge } from '../../src/ui/badge';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { Screen } from '../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../src/ui/theme';

/** 필터 칩 — 단일 선택 (서버 status 단일 값) */
const FILTERS: readonly { label: string; status?: ContentStatus }[] = [
  { label: '전체' },
  { label: '내 확인 대기', status: 'awaiting_reporter_review' },
  { label: '작성 중', status: 'draft' },
  { label: '수정 요청됨', status: 'revision_requested' },
  { label: '송출 완료', status: 'published' },
];

function SkeletonCard(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

/** ② 콘텐츠 목록 — 서버가 우리 지사 강제(동료 것도 보임), 액션은 내 것에만 */
export default function ContentListScreen(): React.JSX.Element {
  const me = useReporter();
  const { signOut } = useSession();
  const [filterIndex, setFilterIndex] = useState(0);
  const filter = useMemo(() => {
    const status = FILTERS[filterIndex]?.status;
    return status ? { status } : {};
  }, [filterIndex]);

  const station = useStation(me.stationId);
  const list = useContentList(filter);

  // offset 페이지네이션이라 목록 변동 시 같은 항목이 페이지 경계에 중복 등장할 수 있다
  // → id 기준 dedupe (FlatList key 중복 방지 — 커서 페이지네이션 전환 전 임시)
  const items = useMemo(() => {
    const byId = new Map<string, ContentSummary>();
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [list.data]);

  const renderCard = ({ item }: { item: ContentSummary }): React.JSX.Element => {
    const badge = statusBadge(item.status);
    const mine = item.reporterId === me.id;
    const needsMyAction = Boolean(badge.needsMyAction) && mine;
    const reporterLabel = mine ? '내 콘텐츠' : (item.reporterName ?? '라이브 녹화');
    return (
      <Pressable
        style={[styles.card, needsMyAction && styles.cardHighlight]}
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
              {needsMyAction ? <Text style={styles.actionLabel}>확인 필요</Text> : null}
            </View>
            <Text style={styles.cardMeta}>
              {CATEGORY_LABEL[item.category]} · {formatDuration(item.durationSec)} ·{' '}
              {formatRelativeTime(item.createdAt)}
            </Text>
            <Text style={[styles.cardMeta, mine && styles.mineLabel]}>담당: {reporterLabel}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: station.data?.name ?? '콘텐츠',
          headerRight: () => (
            <Text style={styles.signOut} onPress={() => void signOut()}>
              로그아웃
            </Text>
          ),
        }}
      />
      <View style={styles.filterRow}>
        {FILTERS.map((f, index) => {
          const selected = index === filterIndex;
          return (
            <Pressable
              key={f.label}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
              onPress={() => setFilterIndex(index)}
            >
              <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
          ListEmptyComponent={
            <EmptyState
              message={'아직 콘텐츠가 없습니다.\n첫 소식을 촬영해 보세요.'}
              ctaLabel="새 콘텐츠 만들기"
              onPressCta={() => router.push('/contents/new')}
            />
          }
        />
      )}
      <Pressable style={styles.fab} onPress={() => router.push('/contents/new')}>
        <Text style={styles.fabLabel}>＋ 새 콘텐츠</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { color: colors.primary, fontSize: typo.caption, padding: spacing.sm },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterLabel: { fontSize: typo.caption, color: colors.text },
  filterLabelSelected: { color: '#FFFFFF', fontWeight: '600' },
  listContent: { padding: spacing.lg, paddingBottom: 96, flexGrow: 1 },
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
  mineLabel: { color: colors.primary, fontWeight: '600' },
  skeletonLine: {
    height: 16,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  skeletonShort: { width: '55%' },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  fabLabel: { color: '#FFFFFF', fontSize: typo.body, fontWeight: '700' },
});
