import { canTransition, isTerminalState } from '../common/state-machine';

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

/* ══════════════════════════════════════════════════════════════════════════
 * 사후 자막 편집 (T-W2-34 — 대장 #123 · 03 §C-4 간단 모드)
 *
 * 간단 모드는 촬영자에게서 자막 부담을 걷어내고(촬영 → 분류 → 업로드), 자막은 **나중에 지사
 * 담당자가 채운다**. 그런데 콘텐츠 수정(`UpdateContentDraftRequest`)은 서버가 `draft`·
 * `revision_requested`에서만 허용하므로(api `ContentsService.EDITABLE_STATUSES`), 업로드가 끝나
 * 파이프라인에 들어간 순간 자막을 채울 방법이 사라진다 — 정본이 전제한 "사후 보강"이 실제로는
 * 불가능했다. 그 공백을 메우는 것이 아래 집합이며, 이것을 소비하는 쓰기 경로는
 * `PATCH /v1/contents/:id/captions` 하나다(자막 외 필드는 못 건드린다).
 *
 * ── 경계 (사용자 결정 2026-08-16: "송출 허용 + 사후 보강") ──────────────────
 * 자막이 없어도 승인·송출은 **막지 않는다**(승인 홉에 자막 가드를 넣지 않는다). 대신 자막은
 * `published` **전까지** 언제든 채울 수 있다. `published` 이후를 닫는 이유는 송출된 뒤에 자막을
 * 바꾸면 이미 나간 방송과 플랫폼에 남은 사본 사이에 정본이 둘로 갈리기 때문이다.
 *
 * ── 파생 규칙 (하드코딩 금지) ─────────────────────────────────────────────
 * 종결 3종(`rejected`·`canceled`·`archived`)은 이름을 적지 않고 **전이 맵에서 파생**한다
 * (출구 0 = 종결). 상태가 늘어도 이 목록은 자동으로 따라온다. 명시적으로 빼는 것은 `published`
 * 하나뿐이며, 그것은 전이 맵이 아니라 위 사용자 결정에서 오는 경계라 여기 코드로 적는다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * ★ 사후 자막 편집이 허용되는 상태 — 발견 수단(목록 필터)과 쓰기 게이트가 **같은 원천**을 쓴다.
 * 둘이 어긋나면 "자막 필요"로 떠 있는 콘텐츠를 열었더니 편집이 409로 거부되는 교착이 생긴다.
 */
export const CAPTION_EDITABLE_CONTENT_STATUSES: readonly ContentStatus[] = (
  Object.keys(CONTENT_STATUS_TRANSITIONS) as ContentStatus[]
).filter(
  (s) => !isTerminalState(CONTENT_STATUS_TRANSITIONS, s) && s !== ContentStatus.Published,
);

/** 지금 자막을 채울 수 있는 상태인가 — 규칙 사본 금지, 이 술어만 쓴다 */
export const isCaptionEditableStatus = (s: ContentStatus): boolean =>
  CAPTION_EDITABLE_CONTENT_STATUSES.includes(s);
