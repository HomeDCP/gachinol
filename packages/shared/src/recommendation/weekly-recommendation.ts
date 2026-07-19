import type { ContentId, JobId, UserId, WeeklyRecommendationId } from '../common/id';
import type { ISODateOnlyString, ISODateString, Timestamps } from '../common/time';

/**
 * 주간 콘텐츠 추천 ★ 센터 승인/수정 루프.
 * 수정 지시 이력은 RevisionRequest(target.kind='recommendation')로 조회.
 * '송출'의 실체(주간뉴스 라이브 큐시트 확정 vs 녹화 묶음 게시)는 운영 확정 대기 —
 * publishing/published 상태는 어느 해석에서도 유효.
 */
export const RecommendationStatus = {
  /** ai-worker 추천 생성 중 */
  Generating: 'generating',
  GenerationFailed: 'generation_failed',
  /** 센터 검토 대기 (관제 앱 표시) */
  PendingReview: 'pending_review',
  /** 센터 수정사항 입력 */
  RevisionRequested: 'revision_requested',
  /** 수정 반영 재생성 중 (generation+1) */
  Regenerating: 'regenerating',
  /** 센터 승인 → 즉시 송출 파이프라인 */
  Approved: 'approved',
  Publishing: 'publishing',
  PublishFailed: 'publish_failed',
  /** [종결] */
  Published: 'published',
  /** 폐기 [종결] */
  Discarded: 'discarded',
} as const;
export type RecommendationStatus = (typeof RecommendationStatus)[keyof typeof RecommendationStatus];

export const RECOMMENDATION_STATUS_TRANSITIONS = {
  generating: ['pending_review', 'generation_failed'],
  generation_failed: ['generating', 'discarded'],
  pending_review: ['approved', 'revision_requested', 'discarded'],
  revision_requested: ['regenerating', 'discarded'],
  /** 재생성 → 다시 센터 검토 (루프) */
  regenerating: ['pending_review', 'generation_failed'],
  /** "승인 시 즉시 송출" */
  approved: ['publishing'],
  publishing: ['published', 'publish_failed'],
  publish_failed: ['publishing', 'discarded'],
  published: [],
  discarded: [],
} as const satisfies Record<RecommendationStatus, readonly RecommendationStatus[]>;

export interface RecommendationItem {
  contentId: ContentId;
  /** 1부터. (recommendationId, rank) unique */
  rank: number;
  /** 0~1 추천 점수 */
  score?: number;
  /** AI 추천 근거 (관제 검토 화면 노출) */
  reason: string;
  /** 하이라이트 구간 제안 */
  highlights?: readonly { startSec: number; endSec: number }[];
}

export interface WeeklyRecommendation extends Timestamps {
  id: WeeklyRecommendationId;
  /** 대상 주차의 월요일 (Asia/Seoul). unique — 주 1건 */
  weekOf: ISODateOnlyString;
  status: RecommendationStatus;
  /** 재생성마다 +1 (같은 행 갱신, items 교체) */
  generation: number;
  /** AI 총평 — 주간뉴스 구성 제안 */
  summary?: string;
  items: readonly RecommendationItem[];
  generatedByJobId: JobId | null;
  /** 센터 검토자 — "누가 승인했나" */
  approvedByUserId: UserId | null;
  approvedAt: ISODateString | null;
  publishedAt: ISODateString | null;
}
