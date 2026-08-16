import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { CreateStationRequest, Station, UpdateStationRequest } from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../src/api/errors';
import { useCenterUser } from '../../../src/auth/auth-context';
import { useBoardFilter } from '../../../src/board/board-filter-context';
import {
  STATION_STATUS_DESCRIPTION,
  STATION_STATUS_LABEL,
  STATION_STATUS_TONE,
  availableStationTransitions,
  type StationTransitionOption,
} from '../../../src/features/stations/actions';
import {
  useCreateStation,
  useTransitionStation,
  useUpdateStation,
} from '../../../src/features/stations/mutations';
import {
  STATION_MANAGE_ADMIN_ONLY_NOTE,
  canManageStations,
  canTransitionStation,
} from '../../../src/features/stations/permissions';
import { useBranchStations } from '../../../src/features/stations/queries';
import { StationFormSheet } from '../../../src/features/stations/station-form';
import {
  emptyStationForm,
  stationToFormValues,
  type StationFormValues,
} from '../../../src/features/stations/validation';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { EmptyState } from '../../../src/ui/empty-state';
import { ErrorView } from '../../../src/ui/error-view';
import { confirmDialog } from '../../../src/ui/feedback';
import { LoadingView } from '../../../src/ui/loading-view';
import { Screen } from '../../../src/ui/screen';
import { showToast } from '../../../src/ui/toast';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';

/**
 * ⑤ 지사 로스터 + 지사 관리 액션 (T-W2-30, 대장 #100).
 *
 * 서버는 `POST /v1/stations/:id/transitions`(부활 dormant→operating 등)·생성·수정을 전부 갖추고
 * 있었는데 3앱 어디에서도 호출하지 않아, CLAUDE.md §11이 MVP로 선언한 "애월·제주시 부활"을
 * 사람이 실행할 수단이 없었다. 이 화면이 그 유일한 경로다.
 *
 * 두 가지가 다르게 취급된다:
 *  - **전이**(부활·휴무 전환·운영 시작) = center_operator·admin
 *  - **생성·수정** = admin 전용 → 권한이 없으면 **버튼을 아예 렌더하지 않는다**
 *    ("있는데 누르면 403"은 Wave 8a에서 실제로 저지른 결함)
 *
 * 집계(주간 업로드 수 등) 엔드포인트는 여전히 부재 → 표기하지 않는다(집계 날조 금지).
 */

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; station: Station };

export default function StationsScreen(): React.JSX.Element {
  const stations = useBranchStations();
  const user = useCenterUser();
  const { setStationId } = useBoardFilter();

  const transition = useTransitionStation();
  const create = useCreateStation();
  const update = useUpdateStation();

  const mayTransition = canTransitionStation(user.role);
  const mayManage = canManageStations(user.role);

  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' });
  const [sheetError, setSheetError] = useState<string | undefined>(undefined);
  /** 전이 진행 중인 지사 — 행 단위 로딩 표시(전역 스피너로 전 행을 잠그지 않는다) */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const openBoardFor = (id: Station['id']): void => {
    setStationId(id);
    router.navigate('/');
  };

  const runTransition = async (
    station: Station,
    option: StationTransitionOption,
  ): Promise<void> => {
    // RNW에서 Alert.alert는 빈 함수라 콜백이 영원히 안 돈다(대장 #92) → confirmDialog(웹 자체 모달)
    const ok = await confirmDialog({
      title: option.confirmTitle,
      message: `${station.name} — ${option.confirmMessage}`,
      confirmText: option.label,
      destructive: option.destructive,
    });
    if (!ok) return;
    setPendingId(station.id);
    transition.mutate(
      { id: station.id, body: { toStatus: option.toStatus } },
      {
        onSuccess: (next) =>
          showToast(`${next.name} · ${STATION_STATUS_LABEL[next.status]}으로 변경했습니다`),
        onError: (err) => {
          // 409는 mutations 훅이 invalidate + 토스트로 처리한다(중복 토스트 금지)
          if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
        },
        onSettled: () => setPendingId(null),
      },
    );
  };

  const openCreate = (): void => {
    setSheetError(undefined);
    setSheet({ kind: 'create' });
  };

  const openEdit = (station: Station): void => {
    setSheetError(undefined);
    setSheet({ kind: 'edit', station });
  };

  const closeSheet = (): void => {
    setSheetError(undefined);
    setSheet({ kind: 'closed' });
  };

  const submitCreate = (body: CreateStationRequest): void => {
    create.mutate(body, {
      onSuccess: (station) => {
        closeSheet();
        showToast(`${station.name}을(를) 추가했습니다 (설립 예정)`);
      },
      onError: (err) => setSheetError(userMessageForError(err)),
    });
  };

  const submitUpdate = (station: Station) => (body: UpdateStationRequest): void => {
    update.mutate(
      { id: station.id, body },
      {
        onSuccess: (next) => {
          closeSheet();
          showToast(`${next.name} 정보를 수정했습니다`);
        },
        onError: (err) => setSheetError(userMessageForError(err)),
      },
    );
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
    const tone = STATION_STATUS_TONE[item.status];
    // 액션 가능 여부·목적 상태는 shared STATION_STATUS_TRANSITIONS에서만 파생된다
    const options = mayTransition ? availableStationTransitions(item.status) : [];
    const busy = pendingId === item.id && transition.isPending;

    return (
      <View style={styles.card}>
        <View style={styles.rowTop}>
          <Text style={styles.name}>{item.name}</Text>
          <Badge label={STATION_STATUS_LABEL[item.status]} tone={tone} />
        </View>
        <Text style={styles.region}>{item.region}</Text>
        <Text style={styles.statusNote}>{STATION_STATUS_DESCRIPTION[item.status]}</Text>
        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        {options.length > 0 || mayManage ? (
          <View style={styles.actionRow}>
            {options.map((option) => (
              <Button
                key={option.action}
                label={option.label}
                variant={option.destructive ? 'destructive' : 'primary'}
                style={styles.actionButton}
                loading={busy}
                disabled={transition.isPending && !busy}
                onPress={() => void runTransition(item, option)}
              />
            ))}
            {mayManage ? (
              <Button
                label="정보 수정"
                variant="secondary"
                style={styles.actionButton}
                onPress={() => openEdit(item)}
              />
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="link"
          onPress={() => openBoardFor(item.id)}
          hitSlop={6}
          style={styles.ctaHit}
        >
          <Text style={styles.cta}>이 지사 검토물 보기 ›</Text>
        </Pressable>
      </View>
    );
  };

  const initialValues: StationFormValues =
    sheet.kind === 'edit' ? stationToFormValues(sheet.station) : emptyStationForm();

  return (
    <Screen>
      <FlatList
        data={stations.data.items}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            {mayManage ? (
              <Button label="＋ 지사 추가" onPress={openCreate} />
            ) : (
              <Text style={styles.headerNote}>{STATION_MANAGE_ADMIN_ONLY_NOTE}</Text>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={stations.isRefetching}
            onRefresh={() => void stations.refetch()}
          />
        }
        ListEmptyComponent={<EmptyState message="등록된 지사가 없습니다" />}
      />

      {/* 생성·수정 시트는 admin에게만 열린다 — 권한 없는 계정에는 트리거 자체가 없다 */}
      {sheet.kind === 'create' ? (
        <StationFormSheet
          mode="create"
          visible
          initial={initialValues}
          submitting={create.isPending}
          serverError={sheetError}
          onSubmit={submitCreate}
          onCancel={closeSheet}
        />
      ) : null}
      {sheet.kind === 'edit' ? (
        <StationFormSheet
          mode="edit"
          visible
          initial={initialValues}
          submitting={update.isPending}
          serverError={sheetError}
          onSubmit={submitUpdate(sheet.station)}
          onCancel={closeSheet}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  header: { marginBottom: spacing.md },
  headerNote: { fontSize: typo.caption, color: colors.textMuted },
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
  statusNote: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  description: { fontSize: typo.caption, color: colors.text, lineHeight: 18 },
  // 버튼이 늘어나 카드를 넘치지 않게 wrap + 고정폭 하한 (RNW flex 기본값 함정 회피)
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flexGrow: 0, flexShrink: 0, minWidth: 120 },
  ctaHit: { alignSelf: 'flex-start', marginTop: spacing.xs },
  cta: { fontSize: typo.caption, color: colors.primary, fontWeight: '600' },
});
