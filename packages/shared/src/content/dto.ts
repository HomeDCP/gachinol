import type { ChannelAccountId, ContentId, SceneId, StationId } from '../common/id';
import type { PageQuery } from '../common/pagination';
import type { ISODateString } from '../common/time';
import type { AiAnalysis } from '../analysis/ai-analysis';
import type { Publication } from '../distribution/publication';
import type { MediaAsset } from '../media/media-asset';
import type { CultureTopic, ProgramCategory } from './category';
import type { CaptionFilter, Content } from './content';
import type { RevisionRequest } from './revision-request';
import type { ContentStatus } from './workflow';

/** 기자 앱 콘텐츠 목록 조회 (관제도 공용) */
export interface ContentListQuery extends PageQuery {
  status?: ContentStatus;
  category?: ProgramCategory;
  /** 관제 공용 */
  stationId?: StationId;
  /**
   * 자막 대기열 필터 (T-W2-34, 대장 #123) — 간단 모드·주민 제보로 자막 없이 들어온 콘텐츠를
   * 지사 담당자가 발견하는 경로. status와 **직교**하지 않는다(값 자체가 상태 조건을 포함한다 —
   * `CaptionFilter` 주석 참조). status와 함께 보내면 둘 다 AND로 적용된다.
   */
  captions?: CaptionFilter;
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
   * 피촬영자 중 만 14세 미만 존재 여부 (T-W2-23 → T-W2-36 재정의: 리마인더용 메타데이터 —
   * 서버는 값을 저장만 하고 어떤 판단도 하지 않는다).
   */
  hasMinorSubject?: boolean;
  targetChannelAccountIds?: readonly ChannelAccountId[];
}

/**
 * 사후 자막 보강 — `PATCH /v1/contents/:id/captions` (T-W2-34, 대장 #123 · 03 §C-4).
 *
 * `UpdateContentDraftRequest`와 **일부러 분리한** 별도 계약이다:
 *  · **상태 범위가 다르다** — 초안 수정은 `draft`·`revision_requested`뿐이지만, 자막 보강은
 *    `published` 전까지 열려 있다(`CAPTION_EDITABLE_CONTENT_STATUSES`).
 *  · **액터 범위가 다르다** — 초안 수정은 담당 기자 본인만, 자막 보강은 **같은 지사 기자**까지다
 *    (정본이 말하는 "지사 담당자". 촬영자에게서 자막 부담을 걷어내는 것이 간단 모드의 목적이라
 *    소유 기자 전용으로 좁히면 그 목적이 무너진다).
 *  · 그래서 **필드가 이것 하나뿐이다** — 넓힌 액터가 제목·분류까지 고칠 수 있으면 안 되므로
 *    타입 수준에서 자막 외 필드를 실을 수 없게 한다.
 *
 * `scenes`는 전량 치환이며 서버가 `order` 기준으로 기존 `SceneId`를 보존 병합한다
 * (`RevisionRequest.sceneNotes`의 참조가 유령이 되지 않게 — `UpdateContentDraftRequest`와 동일 규약).
 */
export interface UpdateContentCaptionsRequest {
  scenes: readonly SceneInput[];
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

/**
 * 멀티파트 업로드 시작 — 대장 #211. Cloudflare 터널 경로가 요청 바디를 **정확히 100MiB(포함)**
 * 까지만 통과시켜(실측, 초과 시 413 — 전체 수신 전 `Content-Length`만 보고 즉시 거부) 단일
 * `IssueUploadUrlRequest`/presigned PUT 하나로는 큰 원본(실촬영 분포 60%가 100MB 초과, 최대 173MB)이
 * 올라가지 않는다. 파트 크기·수는 서버가 결정한다(클라가 100MiB 이상 파트를 요청해 이 문제를
 * 재현하는 것을 원천 차단 — `MULTIPART_PART_SIZE_BYTES`가 단일 원천, services/api s3.service.ts).
 * `IssueUploadUrlRequest`와 필드가 같지만 응답 형태가 달라 별도 계약으로 둔다(기존 계약 무변경 원칙).
 */
export interface CreateMultipartUploadRequest {
  contentId: ContentId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** 파트 1개분 업로드 지시 — 클라는 정확히 `sizeBytes`만큼을 이 presigned PUT에 실어야 한다 */
export interface MultipartUploadPart {
  /** S3 규약 — 1부터 시작하는 연속 정수 */
  partNumber: number;
  uploadUrl: string;
  sizeBytes: number;
}

export interface CreateMultipartUploadResponse {
  storageKey: string;
  /** S3 발급 — 파트 업로드·완료·중단 호출에 그대로 되돌려줘야 함(서버는 DB에 저장하지 않음) */
  uploadId: string;
  /** 마지막 파트를 제외한 파트 크기(참고용 — 실제 절단은 parts[].sizeBytes를 따른다) */
  partSizeBytes: number;
  parts: readonly MultipartUploadPart[];
  expiresAt: ISODateString;
}

/** 파트 업로드 후 브라우저가 응답 헤더에서 읽은 ETag — 완료 호출에 그대로 전달 */
export interface CompletedUploadPart {
  partNumber: number;
  eTag: string;
}

export interface CompleteMultipartUploadRequest {
  contentId: ContentId;
  storageKey: string;
  uploadId: string;
  parts: readonly CompletedUploadPart[];
}

export interface AbortMultipartUploadRequest {
  contentId: ContentId;
  storageKey: string;
  uploadId: string;
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
