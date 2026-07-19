import { canTransition } from '../common/state-machine';

/**
 * 콘텐츠 워크플로우 상태 23종.
 * 단계별 실패 상태를 개별로 두어 재시도 목표가 전이 맵 자체에 표현되게 한다
 * (별도 lastFailedStatus 필드·서비스 계층 가드 불요).
 */
export const ContentStatus = {
  /** 기자 앱에서 촬영·장면 기입·분류 작성 중 */
  Draft: 'draft',
  /** 원본 업로드 진행 중 */
  Uploading: 'uploading',
  /** 업로드 실패 — 재시도 가능 */
  UploadFailed: 'upload_failed',
  /** 원본 저장 완료, 처리 큐 등록 */
  Uploaded: 'uploaded',
  /** media-worker: 트랜스코딩+자동편집 */
  Processing: 'processing',
  ProcessingFailed: 'processing_failed',
  /** ai-worker: 비전+STT/요약 분석 */
  Analyzing: 'analyzing',
  AnalysisFailed: 'analysis_failed',
  /** 저화질 프리뷰 생성 */
  PreviewGenerating: 'preview_generating',
  PreviewFailed: 'preview_failed',
  /** 기자 저화질 프리뷰 확인 대기 ★ */
  AwaitingReporterReview: 'awaiting_reporter_review',
  /** 기자/센터 수정 요청 (상세는 RevisionRequest) */
  RevisionRequested: 'revision_requested',
  /** 수정 반영 재편집·재생성 중 (generation+1) */
  Regenerating: 'regenerating',
  RegenerationFailed: 'regeneration_failed',
  /** 기자 승인 완료 */
  ReporterApproved: 'reporter_approved',
  /** 센터 검토 대기 (reviewPolicy에 따라) */
  AwaitingCenterReview: 'awaiting_center_review',
  /** 센터 승인 → 즉시 송출 */
  CenterApproved: 'center_approved',
  /** 다채널 송출 진행 중 (Publication 생성·실행) */
  Publishing: 'publishing',
  PublishFailed: 'publish_failed',
  /** 송출 완료 (외부 URL은 Publication에) */
  Published: 'published',
  /** 반려 [종결] — 재작업은 새 Content(remakeOfContentId) */
  Rejected: 'rejected',
  /** 파이프라인 중단 [종결] */
  Canceled: 'canceled',
  /** 보관 [종결] */
  Archived: 'archived',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

/**
 * 전이 맵 — 유일한 진실.
 * 완전성 규칙: ① 비종결 상태는 전진 경로 ≥ 1 ② 모든 `*_failed`는 재시도 + canceled 출구 보유
 * ③ 종결 상태는 rejected/canceled/archived 3개뿐 ④ draft 제외 전 상태 도달 가능.
 */
export const CONTENT_STATUS_TRANSITIONS = {
  draft: ['uploading', 'canceled'],
  uploading: ['uploaded', 'upload_failed'],
  upload_failed: ['uploading', 'canceled'],
  uploaded: ['processing', 'canceled'],
  /** processing → preview_generating: 긴급 패스트트랙 (priority='urgent'면 AI 분석 생략) */
  processing: ['analyzing', 'preview_generating', 'processing_failed', 'canceled'],
  processing_failed: ['processing', 'canceled'],
  analyzing: ['preview_generating', 'analysis_failed', 'canceled'],
  /** analysis_failed → preview_generating: 분석 생략 진행 (센터 판단 — 분석 실패가 방송을 막지 않게) */
  analysis_failed: ['analyzing', 'preview_generating', 'canceled'],
  /**
   * preview_generating → awaiting_center_review: 라이브 VOD(origin='live_vod') 전용 —
   * 담당 기자가 없어 기자 승인을 생략하고 센터 검토로 직행 (origin별 분기는 서버 가드).
   */
  preview_generating: ['awaiting_reporter_review', 'awaiting_center_review', 'preview_failed'],
  preview_failed: ['preview_generating', 'canceled'],
  awaiting_reporter_review: ['reporter_approved', 'revision_requested', 'rejected', 'canceled'],
  revision_requested: ['regenerating', 'canceled'],
  /** 재생성 완료 — 재분석 여부는 Job payload `reanalyze`로 분기 */
  regenerating: ['analyzing', 'preview_generating', 'regeneration_failed'],
  regeneration_failed: ['regenerating', 'canceled'],
  reporter_approved: ['awaiting_center_review', 'publishing'],
  /** 센터 수정사항 입력 → 재생성 루프 재진입 (재생성 후 기자 재승인부터 다시 — origin='live_vod'는 센터 검토로 직행) */
  awaiting_center_review: ['center_approved', 'revision_requested', 'rejected'],
  center_approved: ['publishing'],
  publishing: ['published', 'publish_failed'],
  publish_failed: ['publishing', 'canceled'],
  published: ['archived'],
  rejected: [],
  canceled: [],
  archived: [],
} as const satisfies Record<ContentStatus, readonly ContentStatus[]>;

export const canTransitionContent = (from: ContentStatus, to: ContentStatus): boolean =>
  canTransition(CONTENT_STATUS_TRANSITIONS, from, to);

export const ReviewPolicy = {
  /** 기자 승인만으로 송출 (기본: 소속 지사 카톡채널) */
  ReporterOnly: 'reporter_only',
  /** 기자 승인 후 센터 검토 게이트 필요 (주간뉴스 소재·긴급 등 — 기본값 매핑은 서버 설정) */
  ReporterThenCenter: 'reporter_then_center',
} as const;
export type ReviewPolicy = (typeof ReviewPolicy)[keyof typeof ReviewPolicy];

/** 기자 승인 후 다음 상태를 reviewPolicy로 결정 (전이 맵은 구조적 상한, 이 함수가 정책 가드) */
export const afterReporterApproval = (policy: ReviewPolicy): ContentStatus =>
  policy === ReviewPolicy.ReporterThenCenter
    ? ContentStatus.AwaitingCenterReview
    : ContentStatus.Publishing;

/** 실패 상태 → 재시도 시 복귀 상태 */
export const CONTENT_RETRY_TARGET = {
  upload_failed: 'uploading',
  processing_failed: 'processing',
  analysis_failed: 'analyzing',
  preview_failed: 'preview_generating',
  regeneration_failed: 'regenerating',
  publish_failed: 'publishing',
} as const satisfies Partial<Record<ContentStatus, ContentStatus>>;

/** 실패 상태 여부 */
export const isFailureStatus = (s: ContentStatus): boolean => s in CONTENT_RETRY_TARGET;
