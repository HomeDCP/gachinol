import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import type { FeedItem, ProgramCategory } from '@gachinol/shared';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import { userMessageForError } from '../../src/api/errors';
import { useFeedFilter } from '../../src/feed-filter-context';
import { formatDuration, formatRelativeTime } from '../../src/features/feed/format';
import { CATEGORY_LABEL } from '../../src/features/feed/labels';
import { useFeedInfinite, usePublicStations } from '../../src/features/feed/queries';
import type { FeedFilter } from '../../src/query/keys';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { Screen } from '../../src/ui/screen';

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
      <View style={styles.skeletonThumb} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

/** 피드 카드 — 썸네일(없으면 색 박스 폴백) + 메타. expo-image 미도입(신규 deps 회피) */
function FeedCard({ item }: { item: FeedItem }): React.JSX.Element {
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/watch/${item.contentId}`)}>
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={styles.thumbFallbackText}>{CATEGORY_LABEL[item.category]}</Text>
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.cardMeta}>
        {item.stationName} · {CATEGORY_LABEL[item.category]} · {formatDuration(item.durationSec)}
      </Text>
      {item.summary ? (
        <Text style={styles.cardSummary} numberOfLines={2}>
          {item.summary}
        </Text>
      ) : null}
      <Text style={styles.cardTime}>{formatRelativeTime(item.publishedAt)}</Text>
    </Pressable>
  );
}

/** 홈 피드 — published 콘텐츠 무한스크롤 (익명). 지사·분류 칩 필터 */
export default function FeedScreen(): React.JSX.Element {
  const { stationId, setStationId } = useFeedFilter();
  const [category, setCategory] = useState<ProgramCategory | undefined>(undefined);

  const stations = usePublicStations();

  const filter = useMemo<FeedFilter>(
    () => ({
      ...(stationId ? { stationId } : {}),
      ...(category ? { category } : {}),
    }),
    [stationId, category],
  );

  const feed = useFeedInfinite(filter);

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);

  return (
    <Screen>
      {/* 지사 칩 (크로스탭 딥링크 공유) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          style={[styles.chip, !stationId && styles.chipSelected]}
          onPress={() => setStationId(undefined)}
        >
          <Text style={[styles.chipLabel, !stationId && styles.chipLabelSelected]}>전체 지사</Text>
        </Pressable>
        {(stations.data ?? []).map((s) => {
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

      {/* 분류 칩 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
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

      {feed.isPending ? (
        <View style={styles.listContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : feed.isError ? (
        <ErrorView message={userMessageForError(feed.error)} onRetry={() => void feed.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.contentId}
          renderItem={({ item }) => <FeedCard item={item} />}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => void feed.refetch()}
            />
          }
          ListEmptyComponent={<EmptyState message="아직 콘텐츠가 없습니다" />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // horizontal ScrollView는 부모 flex 안에서 세로로 늘거나(flexGrow) 눌린다(flexShrink).
  // 실배포에서 구독자 웹은 넓은 화면에서 칩이 잘렸고, 관제 웹은 칩이 세로로 길게 늘어났다 —
  // 같은 원인의 양방향 증상이다. `style`로 세로 크기를 콘텐츠에 고정한다(contentContainerStyle은
  // 안쪽 여백만 담당하므로 이 문제를 못 막는다).
  chipScroll: { flexGrow: 0, flexShrink: 0 },
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
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.sm, backgroundColor: colors.bg },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { fontSize: typo.body, color: colors.textMuted, fontWeight: '600' },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
  // #68 부분: lineHeight 하드코딩(18) → 토큰 파생. typo.body는 네이티브 18(숫자 그대로 일치)·
  // 웹 1.125rem=18px(root 16px 전제, tokens.css 동일 전제)로 舊 하드코딩 값과 픽셀 단위까지 동일하다.
  cardSummary: { fontSize: typo.caption, color: colors.text, lineHeight: typo.body },
  cardTime: { fontSize: typo.caption, color: colors.textMuted },
  skeletonThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
  },
  skeletonLine: { height: 16, borderRadius: radii.sm, backgroundColor: colors.border },
  skeletonShort: { width: '55%' },
});
