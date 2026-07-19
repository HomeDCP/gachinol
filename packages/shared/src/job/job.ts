import type {
  AiAnalysisId,
  ContentId,
  JobId,
  LiveSessionId,
  MediaAssetId,
  PublicationId,
  RevisionRequestId,
  WeeklyRecommendationId,
} from '../common/id';
import type { ISODateOnlyString, ISODateString } from '../common/time';

export const JobType = {
  /** 트랜스코딩 */
  Transcode: 'transcode',
  /** 자동편집 (재생성 포함 — payload로 구분) */
  AutoEdit: 'auto_edit',
  /** 저화질 프리뷰 생성 */
  Preview: 'preview',
  Thumbnail: 'thumbnail',
  /** 화면(비전) 분석 */
  VisionAnalysis: 'vision_analysis',
  /** 음성→텍스트 */
  Stt: 'stt',
  /** 요약·키워드·태깅 */
  AiSummary: 'ai_summary',
  /** 주간 추천 생성·재생성 */
  Recommendation: 'recommendation',
  /** 채널 송출 실행 */
  Publish: 'publish',
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

export const JobStatus = {
  Queued: 'queued',
  Active: 'active',
  /** [종결] */
  Completed: 'completed',
  /** 자동 재시도 대상 */
  Failed: 'failed',
  /** 재시도 소진 — 센터 수동 재큐 가능 (막다른 상태 아님) */
  Dead: 'dead',
  /** [종결] */
  Canceled: 'canceled',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const JOB_STATUS_TRANSITIONS = {
  queued: ['active', 'canceled'],
  active: ['completed', 'failed', 'canceled'],
  /** 자동 재시도(attempts < maxAttempts) / 소진 */
  failed: ['queued', 'dead'],
  /** 센터 수동 재시도 / 포기 */
  dead: ['queued', 'canceled'],
  completed: [],
  canceled: [],
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

export const JobPriority = {
  Normal: 'normal',
  High: 'high',
  Urgent: 'urgent',
} as const;
export type JobPriority = (typeof JobPriority)[keyof typeof JobPriority];
// Content.priority='urgent' → JobPriority.Urgent (긴급 패스트트랙)

export type JobTarget =
  | { kind: 'content'; contentId: ContentId }
  | { kind: 'live'; liveSessionId: LiveSessionId }
  | { kind: 'recommendation'; recommendationId: WeeklyRecommendationId }
  | { kind: 'publication'; publicationId: PublicationId };

/** 타입별 페이로드 계약 — 큐 생산자(api)와 소비자(worker)가 공유 */
export interface JobPayloadMap {
  transcode: {
    contentId: ContentId;
    sourceAssetId: MediaAssetId;
    renditionLabels: readonly string[];
  };
  auto_edit: {
    contentId: ContentId;
    sourceAssetId: MediaAssetId;
    /** 재생성이면 원인 수정요청 참조 */
    revisionRequestId: RevisionRequestId | null;
    /** 재생성 후 AI 재분석 여부 — regenerating → analyzing vs preview_generating 분기 결정 */
    reanalyze: boolean;
  };
  preview: {
    contentId: ContentId;
    sourceAssetId: MediaAssetId;
    maxHeight: number;
    maxBitrateKbps: number;
  };
  thumbnail: { contentId: ContentId; sourceAssetId: MediaAssetId };
  vision_analysis: { contentId: ContentId; assetId: MediaAssetId; generation: number };
  stt: {
    contentId: ContentId;
    assetId: MediaAssetId;
    generation: number;
    languageHint: 'ko' | null;
  };
  ai_summary: { contentId: ContentId; analysisId: AiAnalysisId };
  recommendation: { weekOf: ISODateOnlyString; revisionRequestId: RevisionRequestId | null };
  publish: { publicationIds: readonly PublicationId[] };
}

/** type·payload를 제외한 공통 필드 — 주 계약은 판별 유니언 Job(=JobOf) */
export interface JobBase {
  /** BullMQ jobId와 동일 문자열 (큐 ↔ DB 대조 용이) */
  id: JobId;
  target: JobTarget;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  /** 기본 3 */
  maxAttempts: number;
  /** 0~100 — 관제 진행률 WS 이벤트의 원천 */
  progress: number;
  lastError?: { message: string; code?: string; at: ISODateString };
  queuedAt: ISODateString;
  startedAt?: ISODateString;
  finishedAt?: ISODateString;
}

/** type으로 payload가 좁혀지는 판별 유니언 */
export type JobOf<T extends JobType = JobType> = T extends JobType
  ? JobBase & { type: T; payload: JobPayloadMap[T] }
  : never;

/**
 * Job 주 계약 = 판별 유니언.
 * type↔payload 불일치 조합은 컴파일 불가, 소비자(worker)는 `job.type === '...'` 분기만으로
 * payload가 좁혀진다 — 캐스팅 금지.
 */
export type Job = JobOf;
