import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ContentStatus, toId } from '@gachinol/shared';
import type {
  AiAnalysis,
  ContentId,
  Publication,
  RevisionRequest,
  SceneId,
  StatusTransitionLog,
} from '@gachinol/shared';
import { isApiClientError, userMessageForError } from '../../../src/api/errors';
import {
  formatConfidence,
  formatDateTime,
  formatDuration,
  formatSec,
} from '../../../src/features/contents/format';
import {
  formatRecommendationScore,
  hasSafetyFlags,
  hasText,
  hasVision,
  isStaleAnalysis,
} from '../../../src/features/contents/analysis';
import {
  centerActionsFor,
  minorConsentActionsFor,
} from '../../../src/features/contents/actions';
import {
  CATEGORY_LABEL,
  CULTURE_TOPIC_LABEL,
  PLATFORM_LABEL,
  PUBLICATION_STATUS_LABEL,
  PUBLICATION_STATUS_TONE,
} from '../../../src/features/contents/labels';
import {
  useApprove,
  useConfirmMinorConsent,
  useDistribute,
  useReject,
  useRequestRevision,
  useRetractPublication,
  useRetry,
  useRetryPublication,
  useTransitionContent,
  useWithdrawMinorConsent,
} from '../../../src/features/contents/mutations';
import {
  useContentDetail,
  useMediaAccessUrl,
  usePublications,
  useTransitionLogs,
} from '../../../src/features/contents/queries';
import {
  STATUS_BADGE_CENTER,
  STATUS_DESCRIPTION_CENTER,
  isTerminalStatus,
  minorConsentBadge,
  statusBadge,
} from '../../../src/features/contents/status';
import {
  validateRejectNote,
  validateRevisionNote,
  validateSceneNote,
} from '../../../src/features/contents/validation';
import { useStation } from '../../../src/features/stations/queries';
import { Badge } from '../../../src/ui/badge';
import { Button } from '../../../src/ui/button';
import { ErrorView } from '../../../src/ui/error-view';
import { LoadingView } from '../../../src/ui/loading-view';
import { Screen } from '../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../src/ui/theme';
import { confirmDialog } from '../../../src/ui/feedback';
import { showToast } from '../../../src/ui/toast';

const TRANSCRIPT_PREVIEW_COUNT = 8;

/**
 * 보관 경고 문구 (대장 #124) — "무엇이 지워지는가"를 정확히 적는다.
 * 근거: `ContentWorkflowService.transition()`의 `to === 'archived'` 커밋 후 훅이
 * `PublicMediaService.removePublishedCopies()`를 부르고, 그 안에서
 *  ① 공개 버킷의 재생용 렌디션·썸네일 복사본을 `deleteObject`로 **삭제**하고
 *  ② 그 공개 URL들을 Cloudflare 캐시에서 **퍼지**한다.
 * 원본(private 버킷의 original·preview)과 전이 이력·AI 분석은 지워지지 않는다.
 * 전이맵상 `archived`의 출구는 0개라 상태 자체도 되돌릴 수 없다.
 */
const ARCHIVE_WARNING =
  '보관하면 공개 서버에 복사돼 있던 재생용 영상·썸네일이 삭제되고 CDN 캐시가 즉시 무효화됩니다. ' +
  '구독자 앱·공개 피드에서 더 이상 재생되지 않습니다. 되돌릴 수 없습니다 — 보관 상태에서 나가는 ' +
  '전이가 없어 다시 송출하려면 새 콘텐츠로 진행해야 합니다. 원본 영상과 전이 이력·AI 분석은 남습니다.';

function statusLabelOf(status: string): string {
  return status in STATUS_BADGE_CENTER
    ? STATUS_BADGE_CENTER[status as keyof typeof STATUS_BADGE_CENTER].label
    : status;
}

/** 칩 그리드 (라벨·키워드·태그) */
function Chips({ values }: { values: readonly string[] }): React.JSX.Element {
  return (
    <View style={styles.chipGrid}>
      {values.map((v, i) => (
        <View key={`${v}-${i}`} style={styles.chip}>
          <Text style={styles.chipText}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** 프리뷰 플레이어 격리 — 서명 GET URL이 오면 재생, 준비 전엔 placeholder */
function PreviewPlayer({ sourceUrl }: { sourceUrl: string | null }): React.JSX.Element {
  const player = useVideoPlayer(sourceUrl);
  if (!sourceUrl) {
    return (
      <View style={styles.playerPlaceholder}>
        <Text style={styles.placeholderText}>
          저화질 프리뷰 준비 중 — 미디어 파이프라인 연동 후 재생됩니다
        </Text>
      </View>
    );
  }
  return <VideoView player={player} style={styles.player} />;
}

/** AI 분석 카드 (읽기 전용) */
function AnalysisCard({
  analysis,
  contentGeneration,
}: {
  analysis: AiAnalysis | undefined;
  contentGeneration: number;
}): React.JSX.Element {
  const [shotsOpen, setShotsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  if (!analysis) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>AI 분석</Text>
        <Text style={styles.metaText}>
          AI 분석 결과가 없습니다 (미분석·긴급 패스트트랙 생략·실패).
        </Text>
      </View>
    );
  }

  const stale = isStaleAnalysis(analysis, contentGeneration);
  const score = formatRecommendationScore(analysis.recommendationScore);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>AI 분석</Text>
      {stale ? (
        <Text style={styles.warningText}>
          이전 세대(v{analysis.generation}) 분석 — 재생성 결과 대기 중
        </Text>
      ) : null}

      {/* 화면(비전) 분석 */}
      {hasVision(analysis) ? (
        <View style={styles.subSection}>
          <Text style={styles.subTitle}>화면 분석</Text>
          {hasSafetyFlags(analysis) ? (
            <View style={styles.dangerBanner}>
              <Text style={styles.dangerBannerText}>
                민감/유해 플래그: {analysis.vision.safetyFlags?.join(', ')}
              </Text>
              <Text style={styles.dangerBannerHint}>송출 전 검수 참고</Text>
            </View>
          ) : null}
          {analysis.vision.labels.length > 0 ? (
            <>
              <Text style={styles.metaText}>화면 라벨</Text>
              <Chips values={analysis.vision.labels} />
            </>
          ) : null}
          <Pressable onPress={() => setShotsOpen((v) => !v)}>
            <Text style={styles.collapseToggle}>
              샷 {analysis.vision.shots.length}개 {shotsOpen ? '▲' : '▼'}
            </Text>
          </Pressable>
          {shotsOpen
            ? analysis.vision.shots.map((shot, i) => (
                <Text key={i} style={styles.metaText}>
                  {formatSec(shot.startSec)}–{formatSec(shot.endSec)}
                  {shot.label ? ` · ${shot.label}` : ''}
                </Text>
              ))
            : null}
          {analysis.vision.thumbnailCandidatesSec?.length ? (
            <Text style={styles.metaText}>
              썸네일 후보:{' '}
              {analysis.vision.thumbnailCandidatesSec.map((s) => formatSec(s)).join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* 텍스트(STT·요약) 분석 */}
      {hasText(analysis) ? (
        <View style={styles.subSection}>
          <Text style={styles.subTitle}>
            텍스트 분석{analysis.text.language ? ` · ${analysis.text.language}` : ''}
          </Text>
          {analysis.text.summary ? (
            <Text style={styles.bodyText}>{analysis.text.summary}</Text>
          ) : null}
          {analysis.text.keywords.length > 0 ? (
            <>
              <Text style={styles.metaText}>키워드</Text>
              <Chips values={analysis.text.keywords} />
            </>
          ) : null}
          {analysis.text.tags.length > 0 ? (
            <>
              <Text style={styles.metaText}>태그</Text>
              <Chips values={analysis.text.tags} />
            </>
          ) : null}
          {analysis.text.transcript.length > 0 ? (
            <>
              <Pressable onPress={() => setTranscriptOpen((v) => !v)}>
                <Text style={styles.collapseToggle}>
                  자막·대사 {analysis.text.transcript.length}개 {transcriptOpen ? '▲' : '▼'}
                </Text>
              </Pressable>
              {transcriptOpen
                ? analysis.text.transcript.slice(0, TRANSCRIPT_PREVIEW_COUNT).map((seg, i) => {
                    const conf = formatConfidence(seg.confidence);
                    return (
                      <Text key={i} style={styles.metaText}>
                        {formatSec(seg.startSec)}–{formatSec(seg.endSec)}: {seg.text}
                        {conf ? ` (${conf})` : ''}
                      </Text>
                    );
                  })
                : null}
              {transcriptOpen && analysis.text.transcript.length > TRANSCRIPT_PREVIEW_COUNT ? (
                <Text style={styles.metaText}>
                  … 외 {analysis.text.transcript.length - TRANSCRIPT_PREVIEW_COUNT}개
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {score ? <Text style={styles.metaText}>주간 추천 점수 {score}</Text> : null}
      {analysis.modelInfo?.version ? (
        <Text style={styles.metaText}>모델 v{analysis.modelInfo.version}</Text>
      ) : null}
    </View>
  );
}

function RevisionCard({
  revision,
  captionOf,
}: {
  revision: RevisionRequest;
  captionOf: (sceneId: string) => string | undefined;
}): React.JSX.Element {
  return (
    <View style={styles.subCard}>
      <Text style={styles.subCardTitle}>
        {revision.requesterRole === 'reporter' ? '기자 요청' : '센터 지시'} ·{' '}
        {formatDateTime(revision.createdAt)}
      </Text>
      <Text style={styles.bodyText}>{revision.message}</Text>
      {revision.sceneNotes?.map((note, i) => (
        <Text key={i} style={styles.metaText}>
          — 장면 &quot;{captionOf(note.sceneId) ?? note.sceneId}&quot;: {note.note}
        </Text>
      ))}
      <Text style={styles.metaText}>
        {revision.resolvedAt ? `반영 완료 ${formatDateTime(revision.resolvedAt)}` : '반영 대기'}
      </Text>
    </View>
  );
}

function LogRow({ log }: { log: StatusTransitionLog }): React.JSX.Element {
  return (
    <View style={styles.logRow}>
      <Text style={styles.bodyText}>
        {statusLabelOf(log.fromStatus)} → {statusLabelOf(log.toStatus)}
      </Text>
      <Text style={styles.metaText}>
        {log.actorType === 'system' ? '자동' : '담당자'} · {formatDateTime(log.at)}
        {log.note ? ` · ${log.note}` : ''}
      </Text>
    </View>
  );
}

/**
 * 채널 1건의 송출 결과. 채널 단위 상태머신은 Content와 독립이라(shared publication.ts)
 * Content가 published여도 개별 채널은 failed일 수 있다 — 그 경우가 재시도 버튼의 존재 이유다.
 * 액션 노출은 shared PUBLICATION_STATUS_TRANSITIONS와 같은 조건이다:
 * failed→queued(재시도) · published→retracted(회수).
 */
function PublicationRow({
  publication,
  onRetry,
  onRetract,
  busy,
}: {
  publication: Publication;
  onRetry: () => void;
  onRetract: () => void;
  busy: boolean;
}): React.JSX.Element {
  const { status, platform } = publication;
  return (
    <View style={styles.logRow}>
      <View style={styles.pubHeader}>
        <Text style={styles.bodyText}>{PLATFORM_LABEL[platform]}</Text>
        <Badge label={PUBLICATION_STATUS_LABEL[status]} tone={PUBLICATION_STATUS_TONE[status]} />
      </View>
      <Text style={styles.metaText}>
        시도 {publication.attempts}회
        {publication.publishedAt ? ` · ${formatDateTime(publication.publishedAt)}` : ''}
      </Text>
      {publication.errorMessage ? (
        <Text style={styles.pubError}>{publication.errorMessage}</Text>
      ) : null}
      {publication.externalUrl ? (
        <Text style={styles.pubLink} numberOfLines={1}>
          {publication.externalUrl}
        </Text>
      ) : null}
      {status === 'failed' ? (
        <Button label="이 채널 재시도" variant="secondary" onPress={onRetry} disabled={busy} />
      ) : status === 'published' ? (
        <Button label="회수" variant="secondary" onPress={onRetract} disabled={busy} />
      ) : null}
    </View>
  );
}

type SheetKind = 'revision' | 'reject' | 'manual-transition' | null;

/** 대장 #98 — revision_requested의 유일한 진행 수단. shared 맵 목적지 2종뿐이라 리터럴 유니온으로 충분 */
type ManualTransitionTarget = 'regenerating' | 'canceled';

/** ③④ 콘텐츠 상세 + AI분석 + 프리뷰 + 이력 + 센터 결정 액션바 (통합 1화면) */
export default function ContentDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');

  // 폴링은 화면 포커스 시에만
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const detail = useContentDetail(contentId, { poll: focused });
  const logs = useTransitionLogs(contentId);
  const approve = useApprove(contentId);
  const requestRevision = useRequestRevision(contentId);
  const reject = useReject(contentId);
  const retry = useRetry(contentId);
  const distribute = useDistribute(contentId);
  const retryPublication = useRetryPublication(contentId);
  const retractPublication = useRetractPublication(contentId);
  const manualTransition = useTransitionContent(contentId);
  const confirmConsent = useConfirmMinorConsent(contentId);
  const withdrawConsent = useWithdrawMinorConsent(contentId);
  const publications = usePublications(contentId, { poll: focused });

  const stationId = detail.data?.content.stationId;
  const station = useStation(stationId);

  // 현 세대 ready 프리뷰 자산 → 서명 GET URL
  const previewAsset = useMemo(
    () =>
      detail.data?.assets.find(
        (a) =>
          a.kind === 'preview' &&
          a.generation === detail.data?.content.generation &&
          a.status === 'ready',
      ),
    [detail.data],
  );
  const previewUrlQuery = useMediaAccessUrl(previewAsset?.id);

  const [logsOpen, setLogsOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [note, setNote] = useState('');
  const [sceneNotes, setSceneNotes] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | undefined>(undefined);

  if (detail.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (detail.isError) {
    const err = detail.error;
    const notFound = isApiClientError(err) && err.status === 404;
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(err)}
          retryLabel={notFound ? '목록으로' : '다시 시도'}
          onRetry={() => (notFound ? router.replace('/') : void detail.refetch())}
        />
      </Screen>
    );
  }

  const { content, revisions } = detail.data;
  const badge = statusBadge(content.status);
  const actions = centerActionsFor(content);
  const previewSourceUrl: string | null = previewUrlQuery.data?.url ?? null;
  const captionOf = (sceneId: string): string | undefined =>
    content.scenes.find((s) => s.id === sceneId)?.caption;
  const logItems = logs.data?.pages.flatMap((p) => p.items) ?? [];
  const orderedScenes = [...content.scenes].sort((a, b) => a.order - b.order);
  const anyPending =
    approve.isPending ||
    requestRevision.isPending ||
    reject.isPending ||
    distribute.isPending ||
    manualTransition.isPending ||
    confirmConsent.isPending ||
    withdrawConsent.isPending;
  const publicationRows = publications.data ?? [];

  /**
   * 동의 철회 가능 여부는 **전이 이력 실측**으로 판정한다(서버와 같은 원천) — 이력을 끝까지
   * 읽었는지를 함께 넘겨야 "아직 못 본 페이지에 게이트 전이가 있는" 경우를 미통과로 오판하지 않는다.
   * 이력 조회는 무한스크롤이라 `hasNextPage`가 false일 때만 완결이다.
   */
  const consent = minorConsentActionsFor(content, {
    logs: logItems,
    complete: logs.isSuccess && !logs.hasNextPage,
  });
  const consentBadge = minorConsentBadge(content);

  const onTransitionError = (err: unknown): void => {
    if (isApiClientError(err) && err.status === 409) {
      // 상태 경합 — mutations 훅이 invalidate+토스트, 시트만 닫는다
      setSheet(null);
      return;
    }
    showToast(userMessageForError(err));
  };

  const confirmApprove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '승인할까요?',
      message: '승인하면 센터 승인 처리되어 송출 단계로 넘어갑니다.',
      confirmText: '승인',
    });
    if (!ok) return;
    approve.mutate(undefined, {
      onSuccess: () => showToast('센터 승인 — 송출 대기'),
      onError: onTransitionError,
    });
  };

  const confirmRetry = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '재시도할까요?',
      message: '실패한 단계를 다시 시도합니다.',
      confirmText: '재시도',
    });
    if (!ok) return;
    retry.mutate(undefined, {
      onSuccess: () => showToast('재시도를 시작했습니다'),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  const confirmDistribute = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '송출할까요?',
      message: '승인된 콘텐츠를 대상 채널로 내보냅니다. 채널별 결과는 아래에서 확인할 수 있습니다.',
      confirmText: '송출',
    });
    if (!ok) return;
    distribute.mutate(undefined, {
      onSuccess: (rows) => showToast(`${rows.length}개 채널로 송출을 시작했습니다`),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  /**
   * 보관(대장 #124) — 되돌릴 수 없는 조작이라 반드시 확인 다이얼로그를 경유한다.
   * `confirmDialog`(src/ui/feedback.tsx)를 쓰는 이유: react-native-web의 `Alert.alert`는 **빈 함수**라
   * 웹에서 다이얼로그가 뜨지도, `onPress` 콜백이 돌지도 않는다(대장 #92 실배포 사고).
   * 운반은 범용 수동 전이지만 목적지는 `centerActionsFor().canArchive`가 shared 전이맵에서 파생한다.
   */
  const confirmArchive = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '보관 처리할까요?',
      message: ARCHIVE_WARNING,
      confirmText: '보관',
      destructive: true,
    });
    if (!ok) return;
    manualTransition.mutate(
      { toStatus: ContentStatus.Archived },
      {
        onSuccess: () => showToast('보관 처리했습니다 — 공개 재생이 중단됩니다'),
        onError: onTransitionError,
      },
    );
  };

  /**
   * 미성년자 동의 확인(대장 #130) — 승인성 조작이라 확인 절차를 둔다.
   * "촬영한 사람과 확인하는 사람을 분리해야 게이트가 실효를 갖는다"(07 §3-3)가 이 버튼이 센터 앱에만
   * 있는 이유이고, 최초 확인자·시각이 감사 기록으로 남아 덮어써지지 않는다는 사실을 문구로 밝힌다.
   */
  const confirmMinorConsentAction = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '법정대리인 동의를 확인했습니까?',
      message:
        '동의서를 직접 확인했음을 기록합니다. 확인 즉시 승인 차단이 풀립니다. ' +
        '확인자와 시각이 감사 기록으로 남으며 최초 확인자는 이후 덮어써지지 않습니다.',
      confirmText: '확인함',
    });
    if (!ok) return;
    confirmConsent.mutate(undefined, {
      onSuccess: () => showToast('동의 확인을 기록했습니다 — 승인 차단이 해제됩니다'),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  /** 동의 확인 철회 — 승인이 다시 차단된다. 이미 승인된 콘텐츠는 버튼 자체가 그려지지 않는다 */
  const confirmWithdrawMinorConsent = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '동의 확인을 철회할까요?',
      message:
        '확인 기록이 지워지고 승인이 다시 차단됩니다. 확인자·시각도 함께 지워집니다 — ' +
        '다시 확인하면 그때의 담당자가 최초 확인자로 기록됩니다.',
      confirmText: '철회',
      destructive: true,
    });
    if (!ok) return;
    withdrawConsent.mutate(undefined, {
      onSuccess: () => showToast('동의 확인을 철회했습니다 — 승인이 다시 차단됩니다'),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  const confirmRetryPublication = async (p: Publication): Promise<void> => {
    const ok = await confirmDialog({
      title: `${PLATFORM_LABEL[p.platform]} 재송출할까요?`,
      message: '이 채널만 다시 시도합니다. 이미 성공한 채널은 영향을 받지 않습니다.',
      confirmText: '재시도',
    });
    if (!ok) return;
    retryPublication.mutate(p.id, {
      onSuccess: () => showToast('재송출을 시작했습니다'),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  const confirmRetract = async (p: Publication): Promise<void> => {
    const ok = await confirmDialog({
      title: `${PLATFORM_LABEL[p.platform]} 송출을 회수할까요?`,
      message: '이미 게시된 콘텐츠를 내립니다. 되돌리려면 다시 송출해야 합니다.',
      confirmText: '회수',
      destructive: true,
    });
    if (!ok) return;
    retractPublication.mutate(p.id, {
      onSuccess: () => showToast('송출을 회수했습니다'),
      onError: (err) => {
        if (!(isApiClientError(err) && err.status === 409)) showToast(userMessageForError(err));
      },
    });
  };

  /**
   * 대장 #98 — revision_requested의 유일한 탈출구. 두 목적지 모두 되돌리기 어려운 조작이라
   * confirmDialog로 한 번 더 확인한다(feedback.tsx — 웹은 Alert.alert이 무동작이라 이 경로가 필수).
   * 'regenerating'은 진짜 탈출구가 아니라 재배치일 뿐이다 — 서버에 그 상태를 나가는 코드가 없어
   * (auto_edit 미구현) 이 앱에서는 이후 되돌릴 수단이 전혀 없다(취소도 안 됨, shared 전이맵 실측:
   * regenerating→{analyzing, preview_generating, regeneration_failed}뿐). 메시지가 그 사실을 명시한다.
   */
  const submitManualTransition = async (to: ManualTransitionTarget): Promise<void> => {
    const ok = await confirmDialog({
      // 고정 문구로 한글 조사(을/를·으로/로) 활용 문제를 원천 차단(대장 #98 보강) — 라벨 보간 금지
      title: to === 'canceled' ? '취소 처리할까요?' : '재생성 상태로 전이할까요?',
      message:
        to === 'canceled'
          ? '파이프라인을 종결합니다. 되돌릴 수 없고 재작업은 새 콘텐츠로 진행합니다.'
          : '자동 재생성 코드가 없어 여기서도 멈춥니다. 이 앱에서는 이후 되돌릴 수단이 없습니다(취소도 불가) — 정말 필요한 경우에만 사용하세요.',
      confirmText: to === 'canceled' ? '취소 처리' : '전이',
      destructive: true,
    });
    if (!ok) return;
    const trimmedNote = note.trim();
    manualTransition.mutate(
      { toStatus: to, ...(trimmedNote ? { note: trimmedNote } : {}) },
      {
        onSuccess: () => {
          setSheet(null);
          showToast(
            to === 'canceled' ? '취소 처리되었습니다' : '재생성 상태로 전이했습니다 (자동 진행 없음)',
          );
        },
        onError: onTransitionError,
      },
    );
  };

  const openSheet = (kind: Exclude<SheetKind, null>): void => {
    setNote('');
    setSceneNotes({});
    setNoteError(undefined);
    setSheet(kind);
  };

  const submitRevision = (): void => {
    const result = validateRevisionNote(note);
    if (!result.ok) {
      setNoteError(result.errors.note);
      return;
    }
    // sceneId는 content.scenes의 id — 각 노트 1..1000 (zCreateRevisionRequestBody)
    const notes = Object.entries(sceneNotes)
      .map(([sceneId, sceneNote]) => ({ sceneId, note: sceneNote.trim() }))
      .filter((n) => n.note.length > 0);
    const tooLong = notes.find((n) => !validateSceneNote(n.note).ok);
    if (tooLong) {
      setNoteError('장면 노트는 각 1000자 이내로 입력해 주세요');
      return;
    }
    setNoteError(undefined);
    requestRevision.mutate(
      {
        note: result.value,
        ...(notes.length > 0
          ? { sceneNotes: notes.map((n) => ({ sceneId: toId<SceneId>(n.sceneId), note: n.note })) }
          : {}),
      },
      {
        onSuccess: () => {
          setSheet(null);
          showToast('수정 요청을 보냈습니다. 반영 후 기자 재승인부터 다시 진행됩니다.');
        },
        onError: onTransitionError,
      },
    );
  };

  const submitReject = (): void => {
    const result = validateRejectNote(note);
    if (!result.ok) {
      setNoteError(result.errors.note);
      return;
    }
    setNoteError(undefined);
    reject.mutate(
      { note: result.value },
      {
        onSuccess: () => {
          setSheet(null);
          showToast('반려 처리되었습니다');
        },
        onError: onTransitionError,
      },
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {/* (a) 상태 카드 */}
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <Badge label={badge.label} tone={badge.tone} />
            {content.priority === 'urgent' ? <Badge label="긴급" tone="danger" /> : null}
          </View>
          <Text style={styles.bodyText}>{STATUS_DESCRIPTION_CENTER[content.status]}</Text>
          {content.lastError ? (
            <Text style={styles.errorText}>
              {content.lastError.message} ({formatDateTime(content.lastError.at)})
            </Text>
          ) : null}
          <Text style={styles.metaText}>산출물 v{content.generation}</Text>
          <Text style={styles.metaText}>
            {content.reviewPolicy === 'reporter_then_center'
              ? '검토 정책: 기자 승인 후 센터 검토'
              : '검토 정책: 기자 승인만으로 송출'}
          </Text>
          {content.origin === 'live_vod' ? (
            <Text style={styles.metaText}>라이브 녹화 (기자 승인 생략)</Text>
          ) : null}
          {content.publishedAt ? (
            <Text style={styles.metaText}>송출 완료 {formatDateTime(content.publishedAt)}</Text>
          ) : null}
        </View>

        {/* (a-2) 미성년자 동의 게이트 — 상태와 직교한 축이라 별도 카드 (대장 #118·#130).
            플래그가 꺼진 대다수 콘텐츠에서는 카드 자체가 렌더되지 않는다. */}
        {consent.applicable ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>미성년자 피촬영자 동의</Text>
            {consentBadge ? (
              <View style={styles.badgeRow}>
                <Badge label={consentBadge.label} tone={consentBadge.tone} />
              </View>
            ) : null}
            {content.minorConsentConfirmedAt ? (
              <Text style={styles.metaText}>
                확인 완료 {formatDateTime(content.minorConsentConfirmedAt)}
              </Text>
            ) : (
              <Text style={styles.warningText}>
                법정대리인 동의서가 확인되지 않아 승인이 차단돼 있습니다. 촬영한 기자가 아니라 센터가
                직접 확인해야 게이트가 실효를 갖습니다.
              </Text>
            )}
            {consent.canConfirm ? (
              <Button
                label="동의 확인"
                onPress={() => void confirmMinorConsentAction()}
                loading={confirmConsent.isPending}
                disabled={anyPending}
              />
            ) : null}
            {consent.canWithdraw ? (
              <Button
                label="동의 확인 철회"
                variant="destructive"
                onPress={() => void confirmWithdrawMinorConsent()}
                loading={withdrawConsent.isPending}
                disabled={anyPending}
              />
            ) : consent.withdrawBlockedBy === 'gate_passed' ? (
              // 서버 withdrawMinorConsent()가 409로 거부하는 조건 — 눌러도 거절될 버튼을 그리지 않는다
              <Text style={styles.metaText}>
                이미 승인 단계를 통과한 콘텐츠라 확인을 철회할 수 없습니다 (철회해도 송출을 막지
                못합니다).
              </Text>
            ) : consent.withdrawBlockedBy === 'history_incomplete' ? (
              <>
                <Text style={styles.metaText}>
                  철회 가능 여부는 전이 이력으로 판정합니다. 이력을 끝까지 불러온 뒤 표시됩니다.
                </Text>
                {logs.hasNextPage ? (
                  <Button
                    label="이력 마저 불러오기"
                    variant="secondary"
                    loading={logs.isFetchingNextPage}
                    onPress={() => void logs.fetchNextPage()}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {/* (b) 기본 정보 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{content.title}</Text>
          <Text style={styles.metaText}>
            {station.data?.name ? `${station.data.name} · ` : ''}
            {CATEGORY_LABEL[content.category]}
            {content.cultureTopics?.length
              ? ` · ${content.cultureTopics.map((t) => CULTURE_TOPIC_LABEL[t]).join(', ')}`
              : ''}
            {' · '}
            {formatDuration(content.durationSec)}
          </Text>
          {content.description ? <Text style={styles.bodyText}>{content.description}</Text> : null}
        </View>

        {/* 프리뷰 재생 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>저화질 프리뷰</Text>
          <PreviewPlayer sourceUrl={previewSourceUrl} />
        </View>

        {/* (d) AI 분석 */}
        <AnalysisCard analysis={detail.data.analysis} contentGeneration={content.generation} />

        {/* (c) 장면 목록 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>장면 ({orderedScenes.length})</Text>
          {orderedScenes.length === 0 ? (
            <Text style={styles.metaText}>장면이 없습니다.</Text>
          ) : (
            orderedScenes.map((scene) => (
              <View key={scene.id} style={styles.subCard}>
                <Text style={styles.bodyText}>
                  {scene.order + 1}. {scene.caption}
                </Text>
                <Text style={styles.metaText}>
                  {scene.startSec !== null && scene.endSec !== null
                    ? `${formatSec(scene.startSec)}~${formatSec(scene.endSec)}`
                    : '구간 미정'}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* (e) 수정요청 (최신순) */}
        {revisions.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>수정 요청</Text>
            {revisions.map((rev) => (
              <RevisionCard key={rev.id} revision={rev} captionOf={captionOf} />
            ))}
          </View>
        ) : null}

        {/* (f) 채널별 송출 결과 — 송출 지시 이후에만 행이 생긴다(지시 전엔 섹션 자체를 숨긴다) */}
        {publicationRows.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>송출 채널 ({publicationRows.length})</Text>
            {publicationRows.map((pub) => (
              <PublicationRow
                key={pub.id}
                publication={pub}
                onRetry={() => void confirmRetryPublication(pub)}
                onRetract={() => void confirmRetract(pub)}
                busy={retryPublication.isPending || retractPublication.isPending}
              />
            ))}
          </View>
        ) : null}

        {/* (f) 전이 이력 (접이식) */}
        <View style={styles.card}>
          <Pressable onPress={() => setLogsOpen((v) => !v)}>
            <Text style={styles.sectionTitle}>이력 {logsOpen ? '▲' : '▼'}</Text>
          </Pressable>
          {logsOpen ? (
            <>
              {logItems.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
              {logs.hasNextPage ? (
                <Button
                  label="더 보기"
                  variant="secondary"
                  loading={logs.isFetchingNextPage}
                  onPress={() => void logs.fetchNextPage()}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* 하단 결정 액션 바 — centerActionsFor 결과로만 렌더 */}
      <View style={styles.actionBar}>
        {actions.canDecide ? (
          <>
            <Button
              label="승인"
              onPress={() => void confirmApprove()}
              loading={approve.isPending}
              disabled={anyPending}
            />
            <Button
              label="수정 요청"
              variant="secondary"
              onPress={() => openSheet('revision')}
              loading={requestRevision.isPending}
              disabled={anyPending}
            />
            <Button
              label="반려"
              variant="destructive"
              onPress={() => openSheet('reject')}
              loading={reject.isPending}
              disabled={anyPending}
            />
          </>
        ) : actions.canDistribute ? (
          <Button
            label="송출"
            onPress={() => void confirmDistribute()}
            loading={distribute.isPending}
            disabled={anyPending}
          />
        ) : actions.canRetry ? (
          <Button label="재시도" onPress={() => void confirmRetry()} loading={retry.isPending} />
        ) : actions.canArchive ? (
          // 대장 #124 — 보관은 "임시 조치 탈출구"가 아니라 되돌릴 수 없는 제품 액션이라
          // 아래 "직접 전이" 시트가 아닌 전용 버튼·전용 경고로 분리한다.
          <>
            <Text style={styles.warningText}>{ARCHIVE_WARNING}</Text>
            <Button
              label="보관"
              variant="destructive"
              onPress={() => void confirmArchive()}
              loading={manualTransition.isPending}
              disabled={anyPending}
            />
          </>
        ) : actions.manualTransitionTargets.length > 0 ? (
          <Button
            label="직접 전이 (임시 조치)"
            variant="secondary"
            onPress={() => openSheet('manual-transition')}
            disabled={anyPending}
          />
        ) : content.status === 'regenerating' ? (
          // regenerating 전용 폴백(대장 #98 보강) — 아래 공용 폴백("기자·파이프라인 소관")은 이 상태에서
          // 거짓이다. 기자도 편집할 수 없고(reporterActionsFor.canEdit는 draft·revision_requested만)
          // 파이프라인도 진행시키지 않는다(auto_edit 미구현) — manualTransitionTargets도 빈 배열이라
          // 이 앱에는 버튼이 아예 없다.
          <Text style={styles.metaText}>
            기자·파이프라인 모두 이 상태를 진행시키지 않습니다. 관리자의 직접 개입이 필요합니다.
          </Text>
        ) : !isTerminalStatus(content.status) ? (
          <Text style={styles.metaText}>지금은 대기 단계입니다 (기자·파이프라인 소관).</Text>
        ) : null}
      </View>

      {/* 수정 요청 / 반려 하단 시트 */}
      <Modal visible={sheet !== null} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {sheet === 'manual-transition' ? (
                <>
                  <Text style={styles.sectionTitle}>직접 전이 (임시 조치)</Text>
                  <Text style={styles.warningText}>
                    자동편집(auto_edit) 기능이 아직 없어 수정 요청 후 자동으로 진행되지 않습니다.
                    아래에서 다음 상태를 직접 선택하세요 — 이것이 유일한 진행 수단입니다.
                  </Text>
                </>
              ) : sheet === 'reject' ? (
                <>
                  <Text style={styles.sectionTitle}>반려</Text>
                  <Text style={styles.warningText}>
                    반려는 되돌릴 수 없습니다. 재작업은 새 콘텐츠로 진행됩니다.
                  </Text>
                </>
              ) : (
                <Text style={styles.sectionTitle}>수정 요청</Text>
              )}
              <TextInput
                style={styles.sheetInput}
                value={note}
                onChangeText={setNote}
                placeholder={
                  sheet === 'manual-transition'
                    ? '메모 (선택, 500자 이내)'
                    : sheet === 'reject'
                      ? '반려 사유 (필수)'
                      : '수정 요청 내용 (필수)'
                }
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={sheet === 'manual-transition' ? 500 : 2000}
              />
              {sheet === 'revision'
                ? orderedScenes.map((scene) => (
                    <View key={scene.id} style={styles.sceneNoteRow}>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {scene.order + 1}. {scene.caption}
                      </Text>
                      <TextInput
                        style={styles.sceneNoteInput}
                        value={sceneNotes[scene.id] ?? ''}
                        onChangeText={(v) => setSceneNotes((prev) => ({ ...prev, [scene.id]: v }))}
                        placeholder="장면별 노트 (선택)"
                        placeholderTextColor={colors.textMuted}
                        maxLength={1000}
                      />
                    </View>
                  ))
                : null}
              {sheet === 'manual-transition' ? (
                <>
                  {actions.manualTransitionTargets.includes('regenerating') ? (
                    <View style={styles.subCard}>
                      {/* 고정 문구(대장 #98 보강) — 라벨 보간형 "{label}(으)로 전이"는 조사 플레이스홀더가
                          그대로 노출됐다("재생성 대기 중(으)로 전이") */}
                      <Text style={styles.bodyText}>재생성 상태로 전이</Text>
                      <Text style={styles.warningText}>
                        진짜 탈출구가 아닙니다 — 재생성을 자동으로 시작하는 코드가 없어 여기서도
                        멈추고, 이 앱에서는 이후 되돌릴 수단이 전혀 없습니다(취소도 불가). 자동편집
                        기능이 도입되면 이어서 처리될 수 있습니다(보장되지 않음).
                      </Text>
                      <Button
                        label="재생성으로 전이"
                        variant="secondary"
                        onPress={() => void submitManualTransition('regenerating')}
                        loading={manualTransition.isPending}
                        disabled={anyPending}
                      />
                    </View>
                  ) : null}
                  {actions.manualTransitionTargets.includes('canceled') ? (
                    <View style={styles.subCard}>
                      <Text style={styles.bodyText}>취소 처리 (권장)</Text>
                      <Text style={styles.metaText}>
                        파이프라인을 깔끔하게 종결합니다. 되돌릴 수 없고 재작업은 새 콘텐츠로
                        진행합니다.
                      </Text>
                      <Button
                        label="취소 처리"
                        variant="destructive"
                        onPress={() => void submitManualTransition('canceled')}
                        loading={manualTransition.isPending}
                        disabled={anyPending}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}
              {noteError ? <Text style={styles.errorText}>{noteError}</Text> : null}
            </ScrollView>
            {sheet === 'manual-transition' ? null : sheet === 'reject' ? (
              <Button
                label="반려 확정"
                variant="destructive"
                onPress={submitReject}
                loading={reject.isPending}
                disabled={anyPending}
              />
            ) : (
              <Button
                label="수정 요청 보내기"
                onPress={submitRevision}
                loading={requestRevision.isPending}
                disabled={anyPending}
              />
            )}
            <Button
              label="닫기"
              variant="secondary"
              onPress={() => setSheet(null)}
              disabled={anyPending}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', gap: spacing.sm },
  cardTitle: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  sectionTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  subSection: { gap: spacing.sm, marginTop: spacing.sm },
  subTitle: { fontSize: typo.caption, fontWeight: '700', color: colors.textMuted },
  bodyText: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  metaText: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
  errorText: { fontSize: typo.caption, color: colors.danger, lineHeight: 18 },
  warningText: { fontSize: typo.caption, color: colors.warning, lineHeight: 18 },
  collapseToggle: { fontSize: typo.caption, color: colors.primary, fontWeight: '600' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { fontSize: typo.caption, color: colors.text },
  dangerBanner: {
    backgroundColor: '#FBE3E3',
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  dangerBannerText: { fontSize: typo.caption, color: colors.danger, fontWeight: '700' },
  dangerBannerHint: { fontSize: typo.caption, color: colors.danger },
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
  placeholderText: {
    color: '#FFFFFF',
    fontSize: typo.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
  subCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  subCardTitle: { fontSize: typo.caption, fontWeight: '700', color: colors.textMuted },
  pubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pubError: { fontSize: typo.caption, color: colors.danger },
  pubLink: { fontSize: typo.caption, color: colors.textMuted },
  logRow: { paddingVertical: spacing.sm, gap: spacing.xs },
  actionBar: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '80%',
  },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { gap: spacing.md },
  sheetInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    padding: spacing.md,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: typo.body,
    color: colors.text,
  },
  sceneNoteRow: { gap: spacing.xs },
  sceneNoteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typo.caption,
    color: colors.text,
  },
});
