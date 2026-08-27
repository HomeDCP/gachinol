import type {
  AiAnalysis,
  ChannelAccountId,
  Content,
  ContentDetail,
  ContentId,
  MediaAsset,
  ContentOrigin,
  ContentPriority,
  ContentStatus,
  ContentSummary,
  CultureTopic,
  ISODateString,
  JobId,
  ProgramCategory,
  Publication,
  RevisionRequest,
  RevisionRequestId,
  RevisionRequesterRole,
  ReviewPolicy,
  SceneId,
  StationId,
  StatusTransitionLog,
  StatusTransitionLogId,
  TransitionEntityType,
  UserId,
  ActorType,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type {
  Content as ContentRow,
  RevisionRequest as RevisionRequestRow,
  StatusTransitionLog as StatusTransitionLogRow,
} from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { zScene } from './schemas/content.schemas';

/** 목록 조회 include 결과 (비정규화 필드 채움용) */
export type ContentRowWithNames = ContentRow & {
  station: { name: string };
  reporter: { name: string } | null;
};

/**
 * row → shared Content. scenes는 읽기 경계에서도 zScene 재검증 —
 * 페이지 크기 ≤100이라 비용 무시 가능, 정합 우선.
 */
export const toContent = (row: ContentRow): Content => {
  const scenes = zScene.array().parse(row.scenes);
  const lastError = row.lastError as { message: string; at: ISODateString } | null;
  return {
    id: toId<ContentId>(row.id),
    stationId: toId<StationId>(row.stationId),
    origin: row.origin as ContentOrigin,
    reporterId: row.reporterId ? toId<UserId>(row.reporterId) : null,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category as ProgramCategory,
    cultureTopics: row.cultureTopics.length ? (row.cultureTopics as CultureTopic[]) : undefined,
    status: row.status as ContentStatus,
    priority: row.priority as ContentPriority,
    reviewPolicy: row.reviewPolicy as ReviewPolicy,
    generation: row.generation,
    scenes,
    targetChannelAccountIds: row.targetChannelAccountIds as ChannelAccountId[],
    tags: row.tags,
    remakeOfContentId: row.remakeOfContentId ? toId<ContentId>(row.remakeOfContentId) : undefined,
    lastError: lastError ?? undefined,
    durationSec: row.durationSec,
    approvedByUserId: row.approvedByUserId ? toId<UserId>(row.approvedByUserId) : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    hasMinorSubject: row.hasMinorSubject,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** row + join → shared ContentSummary (thumbnailUrl은 media_assets 도입 단계에서 채움) */
export const toContentSummary = (row: ContentRowWithNames): ContentSummary => ({
  id: toId<ContentId>(row.id),
  title: row.title,
  category: row.category as ProgramCategory,
  status: row.status as ContentStatus,
  stationId: toId<StationId>(row.stationId),
  stationName: row.station.name,
  reporterId: row.reporterId ? toId<UserId>(row.reporterId) : null,
  reporterName: row.reporter?.name ?? null,
  durationSec: row.durationSec,
  // 미성년 등장 표시 — 가시성 전용 메타데이터 (T-W2-36)
  hasMinorSubject: row.hasMinorSubject,
  createdAt: row.createdAt.toISOString(),
  publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
});

export const toRevisionRequest = (row: RevisionRequestRow): RevisionRequest => {
  if (row.targetKind !== 'content' || !row.contentId) {
    // phase-1은 content 대상만 존재
    throw new DomainException(
      'internal',
      '데이터 불변식 위반: revision_request 대상이 content가 아닙니다',
      {
        revisionRequestId: row.id,
      },
    );
  }
  const sceneNotes = row.sceneNotes as { sceneId: SceneId; note: string }[] | null;
  return {
    id: toId<RevisionRequestId>(row.id),
    target: { kind: 'content', contentId: toId<ContentId>(row.contentId) },
    requestedByUserId: toId<UserId>(row.requestedByUserId),
    requesterRole: row.requesterRole as RevisionRequesterRole,
    message: row.message,
    sceneNotes: sceneNotes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByJobId: row.resolvedByJobId ? toId<JobId>(row.resolvedByJobId) : null,
  };
};

export const toStatusTransitionLog = (row: StatusTransitionLogRow): StatusTransitionLog => ({
  id: toId<StatusTransitionLogId>(row.id),
  entityType: row.entityType as TransitionEntityType,
  entityId: row.entityId,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  actorType: row.actorType as ActorType,
  actorUserId: row.actorUserId ? toId<UserId>(row.actorUserId) : null,
  jobId: row.jobId ? toId<JobId>(row.jobId) : null,
  note: row.note ?? undefined,
  at: row.at.toISOString(),
});

/** 상세 합성 DTO — publications는 매퍼가 이미 shared 투영한 배열을 주입받는다(미송출=[]). */
export const toContentDetail = (
  row: ContentRow,
  revisions: readonly RevisionRequestRow[],
  assets: readonly MediaAsset[] = [], // 미업로드 콘텐츠는 [] (기존 e2e 정합 보존)
  analysis?: AiAnalysis, // 현 세대 분석 (미분석이면 undefined — 기존 정합 보존)
  publications: readonly Publication[] = [], // 미송출 콘텐츠는 [] (기존 e2e 정합 보존)
): ContentDetail => ({
  content: toContent(row),
  assets,
  analysis,
  revisions: revisions.map(toRevisionRequest),
  publications,
});
