import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import type { ResidentUploadReviewItem } from '../../../src/api/resident-uploads';
import { userMessageForError } from '../../../src/api/errors';
import { formatRelativeTime } from '../../../src/features/contents/format';
import { RESIDENT_UPLOAD_FILTERS, residentUploadFilterFromIndex } from '../../../src/features/resident-uploads/filters';
import { residentUploadStatusBadge } from '../../../src/features/resident-uploads/labels';
import { formatBytes } from '../../../src/features/resident-uploads/media';
import { useResidentUploadQueue } from '../../../src/features/resident-uploads/queries';
import { isConsentMissing } from '../../../src/features/resident-uploads/review';
import { Badge } from '../../../src/ui/badge';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

function SkeletonCard(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

/** ① 주민 업로드 검수 대기열 — 03 §C-5, 지사 담당자 승인 필수. 서버가 지사 경계 강제(자기 지사만) */
export default function ResidentUploadQueueScreen(): React.JSX.Element {
  const [filterIndex, setFilterIndex] = useState(0);
  const filter = useMemo(() => residentUploadFilterFromIndex(filterIndex), [filterIndex]);

  const list = useResidentUploadQueue(filter);

  // offset 페이지네이션 — 페이지 경계 중복 대비 id dedupe (contents 목록과 동형)
  const items = useMemo(() => {
    const byId = new Map<string, ResidentUploadReviewItem>();
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [list.data]);

  const renderCard = ({ item }: { item: ResidentUploadReviewItem }): React.JSX.Element => {
    const badge = residentUploadStatusBadge(item.status);
    const consentMissing = isConsentMissing(item.consentAgreedAt);
    return (
      <Pressable
        style={[styles.card, consentMissing && styles.cardWarning]}
        // id만 싣는다 — 상세 화면은 목록 쿼리 캐시에서 항목을 찾는다(qa-verifier 결함①:
        // 항목 전체를 실으면 uploaderContact 같은 검수자 전용 PII가 URL 쿼리스트링에 노출된다)
        onPress={() => router.push(`/resident-uploads/${item.id}`)}
      >
        <View style={styles.badgeRow}>
          <Badge label={badge.label} tone={badge.tone} />
          {consentMissing ? <Badge label="동의 없음" tone="danger" /> : null}
        </View>
        <Text style={styles.cardTitle}>{item.stationName}</Text>
        <Text style={styles.cardMeta}>
          {item.mimeType} · {formatBytes(item.sizeBytes)} · {formatRelativeTime(item.createdAt)}
        </Text>
        <Text style={styles.cardMeta}>
          업로더 연락처(검수자 전용): {item.uploaderContact ?? '미기재'}
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '주민 업로드 검수' }} />
      <View style={styles.filterRow}>
        {RESIDENT_UPLOAD_FILTERS.map((f, index) => {
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
            <EmptyState message={'표시할 업로드가 없습니다.'} />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    gap: spacing.xs,
  },
  cardWarning: { borderColor: colors.danger, borderWidth: 2 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm },
  cardTitle: { fontSize: typo.body, fontWeight: '600', color: colors.text },
  cardMeta: { fontSize: typo.caption, color: colors.textMuted },
  skeletonLine: {
    height: 16,
    borderRadius: radii.sm,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  skeletonShort: { width: '55%' },
});
