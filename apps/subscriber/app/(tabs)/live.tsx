import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { LiveSessionPublic } from '@gachinol/shared';
import { userMessageForError } from '../../src/api/errors';
import { CATEGORY_LABEL } from '../../src/features/feed/labels';
import { formatViewerCount, isOnAir, LIVE_STATUS_LABEL } from '../../src/live/format';
import { useLiveSessions } from '../../src/live/queries';
import { EmptyState } from '../../src/ui/empty-state';
import { ErrorView } from '../../src/ui/error-view';
import { Screen } from '../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../src/ui/theme';

/** 라이브 카드 — 방송중(live)은 빨강 뱃지 강조, 그 외는 회색 예정 뱃지 */
function LiveCard({ item }: { item: LiveSessionPublic }): React.JSX.Element {
  const onAir = isOnAir(item.status);
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/live/${item.id}`)}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusPill, onAir ? styles.statusLive : styles.statusIdle]}>
          {onAir ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.statusText, onAir ? styles.statusTextLive : styles.statusTextIdle]}>
            {LIVE_STATUS_LABEL[item.status]}
          </Text>
        </View>
        {onAir ? <Text style={styles.viewers}>{formatViewerCount(item.viewerCount)}</Text> : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.cardMeta}>{CATEGORY_LABEL[item.type]}</Text>
    </Pressable>
  );
}

/** 라이브 탭 — 공개 세션 목록(예정·준비·방송중·일시중단). 익명 진입 */
export default function LiveScreen(): React.JSX.Element {
  const live = useLiveSessions();
  const items = useMemo(() => live.data ?? [], [live.data]);

  if (live.isError) {
    return (
      <Screen>
        <ErrorView message={userMessageForError(live.error)} onRetry={() => void live.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <LiveCard item={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={live.isRefetching} onRefresh={() => void live.refetch()} />
        }
        ListEmptyComponent={
          live.isPending ? null : (
            <EmptyState message="예정되었거나 진행 중인 라이브가 없습니다" />
          )
        }
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
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusLive: { backgroundColor: '#FBE3E3' },
  statusIdle: { backgroundColor: '#EFEFF1' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  statusText: { fontSize: typo.caption, fontWeight: '700' },
  statusTextLive: { color: colors.danger },
  statusTextIdle: { color: colors.textMuted },
  viewers: { fontSize: typo.caption, color: colors.textMuted },
  cardTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
});
