import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Station, StationStatus } from '@gachinol/shared';
import { userMessageForError } from '../../../src/api/errors';
import { useBoardFilter } from '../../../src/board/board-filter-context';
import { useBranchStations } from '../../../src/features/stations/queries';
import { Badge } from '../../../src/ui/badge';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { LoadingView } from '../../../src/ui/loading-view';
import { Screen } from '../../../src/ui/screen';
import type { BadgeToneName } from '../../../src/ui/theme';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

const STATION_STATUS: Record<StationStatus, { label: string; tone: BadgeToneName }> = {
  operating: { label: '운영 중', tone: 'success' },
  dormant: { label: '휴무', tone: 'neutral' },
  planned: { label: '설립 예정', tone: 'info' },
};

/** ⑤ 지사 목록 (read-only) — StationOverview 집계 부재, 있는 데이터만 표기 */
export default function StationsScreen(): React.JSX.Element {
  const stations = useBranchStations();
  const { setStationId } = useBoardFilter();

  const openBoardFor = (id: Station['id']): void => {
    setStationId(id);
    router.navigate('/');
  };

  if (stations.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (stations.isError) {
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(stations.error)}
          onRetry={() => void stations.refetch()}
        />
      </Screen>
    );
  }

  const renderRow = ({ item }: { item: Station }): React.JSX.Element => {
    const badge = STATION_STATUS[item.status];
    return (
      <Pressable style={styles.card} onPress={() => openBoardFor(item.id)}>
        <View style={styles.rowTop}>
          <Text style={styles.name}>{item.name}</Text>
          <Badge label={badge.label} tone={badge.tone} />
        </View>
        <Text style={styles.region}>{item.region}</Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={styles.cta}>이 지사 검토물 보기 ›</Text>
      </Pressable>
    );
  };

  return (
    <Screen>
      <FlatList
        data={stations.data.items}
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
    gap: spacing.xs,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: typo.body, fontWeight: '700', color: colors.text, flexShrink: 1 },
  region: { fontSize: typo.caption, color: colors.textMuted },
  description: { fontSize: typo.caption, color: colors.text, lineHeight: 18 },
  cta: { fontSize: typo.caption, color: colors.primary, fontWeight: '600', marginTop: spacing.xs },
});
