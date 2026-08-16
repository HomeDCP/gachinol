import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import { toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { getContentDetail } from '../../../src/api/contents';
import { isApiClientError, userMessageForError } from '../../../src/api/errors';
import { getMediaAccessUrl } from '../../../src/api/media';
import { useApiClient } from '../../../src/auth/auth-context';
import { residentUploadActionsFor } from '../../../src/features/resident-uploads/actions';
import { formatDateTime } from '../../../src/features/contents/format';
import { CATEGORY_LABEL } from '../../../src/features/contents/labels';
import { residentUploadStatusBadge } from '../../../src/features/resident-uploads/labels';
import { formatBytes, selectOriginalAsset } from '../../../src/features/resident-uploads/media';
import {
  useApproveResidentUpload,
  useRejectResidentUpload,
} from '../../../src/features/resident-uploads/mutations';
import { useResidentUploadFromCache } from '../../../src/features/resident-uploads/queries';
import { isConsentMissing } from '../../../src/features/resident-uploads/review';
import { contentKeys } from '../../../src/query/keys';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { confirmDialog } from '../../../src/ui/feedback';
import { ErrorView } from '../../../src/ui/error-view';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';
import { showToast } from '../../../src/ui/toast';

/** 원본 플레이어 격리 — 서명 GET URL이 오면 재생, 준비 전엔 안내(contents/[id]/preview.tsx와 동형) */
function OriginalVideoPlayer({ sourceUrl }: { sourceUrl: string | null }): React.JSX.Element {
  const player = useVideoPlayer(sourceUrl);
  if (!sourceUrl) {
    return (
      <View style={styles.playerPlaceholder}>
        <Text style={styles.placeholderText}>원본 영상 확인 중…</Text>
      </View>
    );
  }
  return <VideoView player={player} style={styles.player} />;
}

/**
 * ② 검수 상세 — 원본 재생 + 판단 재료(업로더 연락처·동의 여부) + 승인/반려
 *
 * 항목 데이터는 라우트 파라미터가 아니라 **목록 쿼리 캐시**에서 온다(`useResidentUploadFromCache`).
 * 서버에 단건 조회 엔드포인트가 없어(list·approve·reject 3종뿐) 처음엔 항목 전체를 라우트 파라미터로
 * 실었는데, expo-router가 그걸 URL 쿼리스트링으로 직렬화해 "검수자 전용·무인증 표면 노출 금지"인
 * `uploaderContact`가 브라우저 주소창·히스토리에 평문으로 남는 결함이 됐다(qa-verifier 결함①,
 * 웹 피벗 확정 — 웹이 주 실행 환경). 캐시 조회는 URL에 아무 것도 안 싣는다. 캐시에 없으면(새로고침·
 * 딥링크·북마크) null — 부분 필드만 복구하는 타협 없이 상세를 열지 않고 목록으로 안내한다.
 */
export default function ResidentUploadDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useApiClient();
  const item = useResidentUploadFromCache(id ?? '');

  // 원본 재생 경로: contentId → GET /v1/contents/:id 상세(assets) → original 자산 → 서명 GET URL.
  // (착수 전 확인 ③ — loadReadable은 stationId 기준이라 reporterId=null인 주민 업로드도 자기 지사면 열람 가능)
  const contentId = item?.contentId ? toId<ContentId>(item.contentId) : null;
  const contentDetailQuery = useQuery({
    queryKey: contentId ? contentKeys.detail(contentId) : ['resident-uploads', 'no-content'],
    queryFn: () => getContentDetail(client, contentId!),
    enabled: contentId !== null,
  });

  const originalAsset = contentDetailQuery.data
    ? selectOriginalAsset(contentDetailQuery.data.assets)
    : null;
  const previewUrlQuery = useQuery({
    queryKey: ['media-access-url', originalAsset?.id],
    queryFn: () => getMediaAccessUrl(client, originalAsset!.id),
    enabled: originalAsset != null,
    // 서명 URL 만료(DOWNLOAD_URL_TTL_SEC 기본 900s) 전에 재발급되도록 짧게
    staleTime: 5 * 60 * 1000,
  });

  const approve = useApproveResidentUpload(id ?? '');
  const reject = useRejectResidentUpload(id ?? '');
  const anyPending = approve.isPending || reject.isPending;

  if (!item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '검수 상세' }} />
        <ErrorView
          message="검수 항목 정보를 찾을 수 없습니다. 목록에서 다시 들어와 주세요."
          retryLabel="목록으로"
          onRetry={() => router.replace('/resident-uploads')}
        />
      </Screen>
    );
  }

  const badge = residentUploadStatusBadge(item.status);
  const reviewable = item.status === 'awaiting_branch_review';
  // 승인 가능 여부 — 재생 경로가 확인돼야 판단 근거가 있다고 본다(원본 미확인 상태에서 승인 버튼을 살려두지 않는다)
  const sourceConfirmed = contentId !== null && contentDetailQuery.isSuccess && originalAsset != null;
  const { canApprove, canReject } = residentUploadActionsFor(item.status, {
    sourceConfirmed,
    pending: anyPending,
  });

  const onReviewError = (err: unknown): void => {
    if (isApiClientError(err) && err.status === 409) {
      // 경합 — 뮤테이션 훅이 이미 invalidate+토스트. 스냅샷이 낡았으니 목록으로 복귀
      router.replace('/resident-uploads');
      return;
    }
    showToast(userMessageForError(err));
  };

  const confirmApprove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '승인할까요?',
      message: '승인하면 정식 파이프라인(트랜스코딩)이 시작됩니다. 되돌릴 수 없습니다.',
      confirmText: '승인',
    });
    if (!ok) return;
    approve.mutate(undefined, {
      onSuccess: () => {
        showToast('승인되었습니다 — 정식 파이프라인에 진입했습니다');
        router.replace('/resident-uploads');
      },
      onError: onReviewError,
    });
  };

  const confirmReject = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '반려할까요?',
      message: '반려는 되돌릴 수 없습니다. 사유는 기록되지 않습니다.',
      confirmText: '반려',
      destructive: true,
    });
    if (!ok) return;
    reject.mutate(undefined, {
      onSuccess: () => {
        showToast('반려되었습니다');
        router.replace('/resident-uploads');
      },
      onError: onReviewError,
    });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '검수 상세' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {contentId ? (
          <OriginalVideoPlayer sourceUrl={previewUrlQuery.data?.url ?? null} />
        ) : (
          <View style={styles.playerPlaceholder}>
            <Text style={styles.placeholderText}>
              업로드 완료 통지를 받지 못한 건입니다 — 원본을 확인할 수 없습니다
            </Text>
          </View>
        )}
        {contentId && contentDetailQuery.isError ? (
          <Text style={styles.errorText}>
            {userMessageForError(contentDetailQuery.error)} (원본 콘텐츠 조회 실패)
          </Text>
        ) : null}
        {contentId && contentDetailQuery.isSuccess && !originalAsset ? (
          <Text style={styles.errorText}>
            원본 영상을 찾을 수 없어 승인할 수 없습니다 — 주민에게 다시 올려달라고 요청하거나
            반려해 주세요
          </Text>
        ) : null}

        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Badge label={badge.label} tone={badge.tone} />
            {isConsentMissing(item.consentAgreedAt) ? <Badge label="동의 없음" tone="danger" /> : null}
          </View>
          {isConsentMissing(item.consentAgreedAt) ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                이용허락 클릭동의 없이 접수된 건입니다(07 §3-15). 검수 시 참고해 주세요.
              </Text>
            </View>
          ) : (
            <Text style={styles.metaText}>
              이용허락 동의 시각: {formatDateTime(item.consentAgreedAt)}
            </Text>
          )}
          <Text style={styles.bodyText}>지사: {item.stationName}</Text>
          <Text style={styles.metaText}>
            업로더 연락처(검수자 전용): {item.uploaderContact ?? '미기재'}
          </Text>
          <Text style={styles.metaText}>
            {item.mimeType} · {formatBytes(item.sizeBytes)}
          </Text>
          <Text style={styles.metaText}>접수 {formatDateTime(item.createdAt)}</Text>
          {item.completedAt ? (
            <Text style={styles.metaText}>업로드 완료 {formatDateTime(item.completedAt)}</Text>
          ) : null}
          {!reviewable ? (
            <Text style={styles.metaText}>
              검수 완료 {item.reviewedAt ? formatDateTime(item.reviewedAt) : ''}
              {item.reviewedByUserId ? ` · 검수자 ${item.reviewedByUserId}` : ''}
            </Text>
          ) : null}
        </View>

        {contentDetailQuery.data ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>연결된 콘텐츠</Text>
            <Text style={styles.bodyText}>{contentDetailQuery.data.content.title}</Text>
            <Text style={styles.metaText}>
              {CATEGORY_LABEL[contentDetailQuery.data.content.category]} · 제목·분류는 승인 후 확정합니다
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {reviewable ? (
        <View style={styles.actionBar}>
          <Button
            label={sourceConfirmed ? '승인' : contentDetailQuery.isLoading ? '원본 확인 중…' : '승인 불가'}
            onPress={() => void confirmApprove()}
            loading={approve.isPending}
            disabled={!canApprove}
          />
          <Button
            label="반려"
            variant="destructive"
            onPress={() => void confirmReject()}
            loading={reject.isPending}
            disabled={!canReject}
          />
        </View>
      ) : (
        <View style={styles.actionBar}>
          <Text style={styles.metaText}>이미 검수가 완료된 건입니다.</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  player: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md },
  playerPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.md,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  placeholderText: { color: '#FFFFFF', fontSize: typo.caption, textAlign: 'center', lineHeight: 18 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  bodyText: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  metaText: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  errorText: { fontSize: typo.caption, color: colors.danger, lineHeight: 18 },
  warningBox: {
    backgroundColor: '#FBE3E3',
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  warningText: { fontSize: typo.caption, color: colors.danger, fontWeight: '600', lineHeight: 18 },
  actionBar: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
});
