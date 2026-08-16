import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import type { StationStatus, StationSummary } from '@gachinol/shared';
import type { BadgeToneName } from '@gachinol/ui';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import { userMessageForError } from '../../src/api/errors';
import { useFeedFilter } from '../../src/feed-filter-context';
import { usePublicStations } from '../../src/features/feed/queries';
import { Badge } from '../../src/ui/badge';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { LoadingView } from '../../src/ui/loading-view';
import { Screen } from '../../src/ui/screen';

// 서버는 operating·dormant만 반환(planned·center 제외)하나 StationStatus 전수 표기(타입 강제)
const STATION_STATUS: Record<StationStatus, { label: string; tone: BadgeToneName }> = {
  operating: { label: '운영 중', tone: 'success' },
  dormant: { label: '휴무', tone: 'neutral' },
  planned: { label: '설립 예정', tone: 'info' },
};

const STATIONS_TITLE = '지사 목록 — 가치놀';
const STATIONS_DESCRIPTION = '제주 마을방송국 지사 목록을 확인하고, 원하는 지사의 소식만 골라 보세요.';

/** 지사 목록 라우트 고정(정적) OG 메타 — 홈과 동일 원칙(index.tsx의 HomeHead 주석 참조) */
function StationsHead(): React.JSX.Element {
  return (
    <Head>
      <title>{STATIONS_TITLE}</title>
      <meta name="description" content={STATIONS_DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={STATIONS_TITLE} />
      <meta property="og:description" content={STATIONS_DESCRIPTION} />
    </Head>
  );
}

/** 공개 지사 탐색 — 마을방송국(지사)만. 탭하면 해당 지사로 피드 필터 후 피드 탭 이동 */
export default function StationsScreen(): React.JSX.Element {
  const stations = usePublicStations();
  const { setStationId } = useFeedFilter();

  const openFeedFor = (id: StationSummary['id']): void => {
    setStationId(id);
    router.navigate('/');
  };

  if (stations.isPending) {
    return (
      <Screen>
        <StationsHead />
        <LoadingView />
      </Screen>
    );
  }
  if (stations.isError) {
    return (
      <Screen>
        <StationsHead />
        <ErrorView
          message={userMessageForError(stations.error)}
          onRetry={() => void stations.refetch()}
        />
      </Screen>
    );
  }

  const renderRow = ({ item }: { item: StationSummary }): React.JSX.Element => {
    const badge = STATION_STATUS[item.status];
    return (
      <Pressable style={styles.card} onPress={() => openFeedFor(item.id)}>
        <View style={styles.rowTop}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]} />
          )}
          <View style={styles.rowBody}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Badge label={badge.label} tone={badge.tone} />
            </View>
            <Text style={styles.region}>{item.region}</Text>
            <Text style={styles.cta}>이 지사 콘텐츠 보기 ›</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      <StationsHead />
      <FlatList
        data={stations.data}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={stations.isRefetching}
            onRefresh={() => void stations.refetch()}
          />
        }
        ListEmptyComponent={<EmptyState message="등록된 지사가 없습니다" />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rowTop: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radii.sm, backgroundColor: colors.bg },
  thumbFallback: { borderWidth: 1, borderColor: colors.border },
  rowBody: { flex: 1, gap: spacing.xs },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: { fontSize: typo.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  region: { fontSize: typo.caption, color: colors.textMuted },
  cta: { fontSize: typo.caption, color: colors.primary, fontWeight: '600', marginTop: spacing.xs },
});
