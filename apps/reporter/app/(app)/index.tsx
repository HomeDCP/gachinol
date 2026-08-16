import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import type { ContentStatus, ContentSummary } from '@gachinol/shared';
import { CaptionFilter } from '@gachinol/shared';
import { userMessageForError } from '../../src/api/errors';
import { useReporter, useSession } from '../../src/auth/auth-context';
import { formatDuration, formatRelativeTime } from '../../src/features/contents/format';
import { CATEGORY_LABEL } from '../../src/features/contents/labels';
import {
  useCaptionNeededCount,
  useContentList,
  useStation,
} from '../../src/features/contents/queries';
import { statusBadge } from '../../src/features/contents/status';
import { ProcessingHoldBanner } from '../../src/features/system/components/processing-hold-banner';
import { shouldShowHoldBanner } from '../../src/features/system/processing-hold';
import { useHoldReleaseToast, useProcessingState } from '../../src/features/system/queries';
import { Badge } from '../../src/ui/badge';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { Screen } from '../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../src/ui/theme';

/**
 * 필터 칩 — 단일 선택. status 축과 captions 축이 섞여 있지만 칩은 하나만 켜지므로
 * 서버에는 항상 둘 중 하나만 간다.
 */
const CAPTION_NEEDED_FILTER_INDEX = 1;
const FILTERS: readonly {
  label: string;
  status?: ContentStatus;
  captions?: CaptionFilter;
}[] = [
  { label: '전체' },
  // 자막 대기열 (T-W2-34, 대장 #123) — 간단 모드·주민 제보로 자막 없이 들어온 것 중 채울 수 있는 것
  { label: '자막 필요', captions: CaptionFilter.Needed },
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
    const selected = FILTERS[filterIndex];
    return {
      ...(selected?.status ? { status: selected.status } : {}),
      ...(selected?.captions ? { captions: selected.captions } : {}),
    };
  }, [filterIndex]);
  const captionsFiltered = filter.captions === CaptionFilter.Needed;

  const station = useStation(me.stationId);
  const list = useContentList(filter);
  // 자막 대기열 건수 — 필터를 켜지 않아도 보이는 자리에 둔다(발견 수단, T-W2-34)
  const captionNeeded = useCaptionNeededCount();

  // 처리 게이트 — 정지 중이면 목록 상단에 안내, 해제되면 토스트 1회
  const processing = useProcessingState();
  useHoldReleaseToast(processing.data);

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
              {/* 서버가 자막 0건만 돌려준 목록이라 배지는 구성상 항상 참이다 — ContentSummary에는
                  장면 수가 없으므로 전체 목록에서는 이 배지를 띄우지 않는다(추측 금지) */}
              {captionsFiltered ? <Badge label="자막 없음" tone="warning" /> : null}
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
      {shouldShowHoldBanner(processing.data) ? (
        <View style={styles.bannerSlot}>
          <ProcessingHoldBanner state={processing.data!} />
        </View>
      ) : null}
      <Pressable
        style={styles.residentUploadEntry}
        onPress={() => router.push('/resident-uploads')}
      >
        <Text style={styles.residentUploadEntryTitle}>주민 업로드 검수</Text>
        <Text style={styles.residentUploadEntryMeta}>
          우리 지사에 접수된 주민 제보 영상을 확인하세요 ›
        </Text>
      </Pressable>
      {/* 자막 대기열 진입 (T-W2-34) — 0건이면 숨긴다(할 일이 없는데 자리를 차지하지 않게) */}
      {captionNeeded.data ? (
        <Pressable
          style={[styles.residentUploadEntry, styles.captionEntry]}
          onPress={() => setFilterIndex(CAPTION_NEEDED_FILTER_INDEX)}
        >
          <Text style={styles.residentUploadEntryTitle}>
            자막 필요 {captionNeeded.data}건
          </Text>
          <Text style={styles.residentUploadEntryMeta}>
            간단 모드·주민 제보로 올라온 영상의 자막을 채워 주세요 ›
          </Text>
        </Pressable>
      ) : null}
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
            captionsFiltered ? (
              // 자막 필터에서 "첫 소식을 촬영해 보세요"는 거짓이다 — 대기열이 비었을 뿐이다
              <EmptyState
                message={'자막을 기다리는 콘텐츠가 없습니다.\n모두 채워졌습니다.'}
                ctaLabel="전체 보기"
                onPressCta={() => setFilterIndex(0)}
              />
            ) : (
              <EmptyState
                message={'아직 콘텐츠가 없습니다.\n첫 소식을 촬영해 보세요.'}
                ctaLabel="새 콘텐츠 만들기"
                onPressCta={() => router.push('/contents/new')}
              />
            )
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
  bannerSlot: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  residentUploadEntry: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  captionEntry: { borderColor: colors.warning },
  residentUploadEntryTitle: { fontSize: typo.body, fontWeight: '600', color: colors.text },
  residentUploadEntryMeta: { fontSize: typo.caption, color: colors.textMuted },
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
