import type { ChannelAccountId, ContentId, SceneId, StationId } from '../common/id';
import type { PageQuery } from '../common/pagination';
import type { ISODateString } from '../common/time';
import type { AiAnalysis } from '../analysis/ai-analysis';
import type { Publication } from '../distribution/publication';
import type { MediaAsset } from '../media/media-asset';
import type { CultureTopic, ProgramCategory } from './category';
import type { Content } from './content';
import type { RevisionRequest } from './revision-request';
import type { ContentStatus } from './workflow';

/** 기자 앱 콘텐츠 목록 조회 (관제도 공용) */
export interface ContentListQuery extends PageQuery {
  status?: ContentStatus;
  category?: ProgramCategory;
  /** 관제 공용 */
  stationId?: StationId;
}

export interface SceneInput {
  order: number;
  caption: string;
  description?: string;
  startSec: number | null;
  endSec: number | null;
}

export interface CreateContentDraftRequest {
  title: string;
  description?: string;
  category: ProgramCategory;
  cultureTopics?: readonly CultureTopic[];
  scenes: readonly SceneInput[];
  /** 피촬영자 중 만 14세 미만 존재 여부 — 미전송 시 false (07 §3-3·02 §E-20, T-W2-23) */
  hasMinorSubject?: boolean;
  /**
   * 반려(rejected)·취소(canceled)된 콘텐츠 재작업 시 원본 참조 (T-W2-20).
   * 서버가 검증: 원본 실재·상태(rejected|canceled)·같은 지사(stationId) 소속.
   */
  remakeOfContentId?: ContentId;
}

/** 부분 수정 — draft·revision_requested 상태에서만 허용 (서버 검증) */
export interface UpdateContentDraftRequest {
  title?: string;
  description?: string;
  category?: ProgramCategory;
  cultureTopics?: readonly CultureTopic[];
  scenes?: readonly SceneInput[];
  /**
   * 피촬영자 중 만 14세 미만 존재 여부 (T-W2-23). fail-closed 불변식: true→false로 내리면
   * 서버가 같은 update에서 확인 기록(minorConsentConfirmedByUserId·At)도 함께 지운다 —
   * 켬→센터 확인→끔→다시 켬으로 동의 게이트를 우회하는 경로를 막는다.
   */
  hasMinorSubject?: boolean;
  targetChannelAccountIds?: readonly ChannelAccountId[];
}

export interface IssueUploadUrlRequest {
  contentId: ContentId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface IssueUploadUrlResponse {
  storageKey: string;
  /** presigned PUT (멀티파트 확장은 open question) */
  uploadUrl: string;
  expiresAt: ISODateString;
}

export interface CompleteUploadRequest {
  contentId: ContentId;
  storageKey: string;
}

/** 수정 요청 바디 — requesterRole은 서버가 인증 role로 판정 */
export interface CreateRevisionRequestBody {
  note: string;
  sceneNotes?: readonly { sceneId: SceneId; note: string }[];
}

/** POST /v1/contents/:id/transitions (운영 복구·워커 부재 기간 파이프라인 수동 진행용 범용 전이) */
export interface TransitionContentRequest {
  toStatus: ContentStatus;
  note?: string;
}

/** 반려 — 사유 필수 */
export interface RejectContentRequest {
  note: string;
}

/** 취소 — 사유 선택 */
export interface CancelContentRequest {
  note?: string;
}

/** 상세 화면 합성 DTO — 기자 프리뷰 확인·관제 검토 공용 */
export interface ContentDetail {
  content: Content;
  /** 현 generation 산출물 */
  assets: readonly MediaAsset[];
  analysis?: AiAnalysis;
  /** 최신순 */
  revisions: readonly RevisionRequest[];
  publications: readonly Publication[];
}
