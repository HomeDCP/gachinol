import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
import { toId } from '@gachinol/shared';
import type {
  AiAnalysis,
  ContentId,
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
import { centerActionsFor } from '../../../src/features/contents/actions';
import { CATEGORY_LABEL, CULTURE_TOPIC_LABEL } from '../../../src/features/contents/labels';
import {
  useApprove,
  useReject,
  useRequestRevision,
  useRetry,
} from '../../../src/features/contents/mutations';
import {
  useContentDetail,
  useMediaAccessUrl,
  useTransitionLogs,
} from '../../../src/features/contents/queries';
import {
  STATUS_BADGE_CENTER,
  STATUS_DESCRIPTION_CENTER,
  isTerminalStatus,
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
import { showToast } from '../../../src/ui/toast';

const TRANSCRIPT_PREVIEW_COUNT = 8;

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

type SheetKind = 'revision' | 'reject' | null;

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
  const anyPending = approve.isPending || requestRevision.isPending || reject.isPending;

  const onTransitionError = (err: unknown): void => {
    if (isApiClientError(err) && err.status === 409) {
      // 상태 경합 — mutations 훅이 invalidate+토스트, 시트만 닫는다
      setSheet(null);
      return;
    }
    showToast(userMessageForError(err));
  };

  const confirmApprove = (): void => {
    Alert.alert('승인할까요?', '승인하면 센터 승인 처리되어 송출 단계로 넘어갑니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '승인',
        onPress: () =>
          approve.mutate(undefined, {
            onSuccess: () => showToast('센터 승인 — 송출 대기'),
            onError: onTransitionError,
          }),
      },
    ]);
  };

  const confirmRetry = (): void => {
    Alert.alert('재시도할까요?', '실패한 단계를 다시 시도합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '재시도',
        onPress: () =>
          retry.mutate(undefined, {
            onSuccess: () => showToast('재시도를 시작했습니다'),
            onError: (err) => {
              if (!(isApiClientError(err) && err.status === 409))
                showToast(userMessageForError(err));
            },
          }),
      },
    ]);
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
              onPress={confirmApprove}
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
        ) : actions.canRetry ? (
          <Button label="재시도" onPress={confirmRetry} loading={retry.isPending} />
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
              {sheet === 'reject' ? (
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
                placeholder={sheet === 'reject' ? '반려 사유 (필수)' : '수정 요청 내용 (필수)'}
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
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
              {noteError ? <Text style={styles.errorText}>{noteError}</Text> : null}
            </ScrollView>
            {sheet === 'reject' ? (
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
