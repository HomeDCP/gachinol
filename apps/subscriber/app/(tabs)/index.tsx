import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import type { FeedItem, ProgramCategory } from '@gachinol/shared';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';
import { userMessageForError } from '../../src/api/errors';
import { useFeedFilter } from '../../src/feed-filter-context';
import { formatDuration, formatRelativeTime } from '../../src/features/feed/format';
import { CATEGORY_LABEL } from '../../src/features/feed/labels';
import { useFeedInfinite, usePublicStations } from '../../src/features/feed/queries';
import {
  buildKakaoExternalOpenUrl,
  evaluateAndRecordHomeBanner,
  type HomeAddPlatformHint,
  type HomeBannerVariant,
} from '../../src/features/home/home-banner';
import type { FeedFilter } from '../../src/query/keys';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { Screen } from '../../src/ui/screen';

const HOME_TITLE = '가치놀 — 제주 마을방송';
const HOME_DESCRIPTION = '제주 각 마을방송국 소식을 카카오톡 없이 한 곳에서 무료로 시청하세요.';

/**
 * 홈 라우트 고정(정적) OG 메타 — 이 태스크(T-W1-03)가 채우는 것은 홈·지사 목록 같은 "고정 페이지"
 * 뿐이다. 콘텐츠별 동적 OG(썸네일·제목)는 `go.` 링크(T-W1-05, api 경량 SSR)가 이미 소유한다 —
 * 여기서 SSR을 흉내 내지 않는다(`expo export --platform web`은 SSR이 아니라 라우트별 정적
 * 프리렌더라 `Head`가 실제 정적 HTML에 반영된다 — 완료 보고의 검증 절 참조).
 */
function HomeHead(): React.JSX.Element {
  return (
    <Head>
      <title>{HOME_TITLE}</title>
      <meta name="description" content={HOME_DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={HOME_TITLE} />
      <meta property="og:description" content={HOME_DESCRIPTION} />
    </Head>
  );
}

/**
 * 홈화면 추가(PWA) 안내 배너(03 §A-5) — 판정+기록 로직은 전부 `src/features/home/home-banner.ts`의
 * `evaluateAndRecordHomeBanner`(목 스토리지로 단위 테스트 대상, 보강 3)가 책임진다. 이 훅은 그
 * 함수를 부르는 것 외에 아무 로직도 갖지 않는다 — 네이티브(쉘) 빌드에는 A2HS 개념이 없으므로
 * web에서만 동작한다.
 */
function useHomeBanner(): {
  variant: HomeBannerVariant;
  platformHint: HomeAddPlatformHint;
  dismiss: () => void;
} {
  const [variant, setVariant] = useState<HomeBannerVariant>('hidden');
  const [platformHint, setPlatformHint] = useState<HomeAddPlatformHint>('other');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const result = evaluateAndRecordHomeBanner(window.localStorage, window.navigator.userAgent ?? '', true);
    setVariant(result.variant);
    setPlatformHint(result.platformHint);
  }, []);

  return { variant, platformHint, dismiss: () => setVariant('hidden') };
}

function HomeAddBanner(): React.JSX.Element | null {
  const { variant, platformHint, dismiss } = useHomeBanner();

  if (variant === 'hidden') return null;

  const openInExternalBrowser = (): void => {
    if (typeof window === 'undefined') return;
    void Linking.openURL(buildKakaoExternalOpenUrl(window.location.href));
  };

  const addToHomeInstruction =
    platformHint === 'ios'
      ? "화면 아래 [공유] 버튼을 누르고 '홈 화면에 추가'를 선택하시면"
      : "화면 우측 상단 점 3개 메뉴에서 '홈 화면에 추가'를 선택하시면";

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        {variant === 'open_in_browser'
          ? '카카오톡 안에서는 홈 화면에 추가할 수 없어요. 아래 버튼으로 다른 브라우저에서 열어주세요.'
          : `다음에도 카카오톡 없이 바로 보고 싶으세요? ${addToHomeInstruction}, 우리 마을방송 아이콘이 휴대폰 화면에 생깁니다.`}
      </Text>
      <View style={styles.bannerActions}>
        {variant === 'open_in_browser' ? (
          <Pressable style={styles.bannerCta} onPress={openInExternalBrowser}>
            <Text style={styles.bannerCtaText}>다른 브라우저로 열기</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.bannerClose} onPress={dismiss} hitSlop={spacing.sm}>
          <Text style={styles.bannerCloseText}>닫기</Text>
        </Pressable>
      </View>
    </View>
  );
}

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
      <HomeHead />
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
      <HomeAddBanner />
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
  // 홈화면 추가 배너(03 §A-5) — flexGrow:0 기본값 그대로 자연 높이, FlatList가 남는 공간만 차지한다
  // (위 chipScroll 주석과 동일 원리, 여기서는 명시적 override가 필요 없다).
  banner: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bannerText: { fontSize: typo.caption, color: colors.text, lineHeight: typo.body },
  bannerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  bannerCta: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
  },
  bannerCtaText: { color: '#FFFFFF', fontSize: typo.caption, fontWeight: '700' },
  bannerClose: {
    minHeight: touchTarget.min,
    minWidth: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  bannerCloseText: { color: colors.textMuted, fontSize: typo.caption, fontWeight: '600' },
});
