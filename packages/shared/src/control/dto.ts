import type { PageQuery } from '../common/pagination';
import type { ISODateString } from '../common/time';
import type { ContentSummary } from '../content/content';
import type { JobStatus, JobType } from '../job/job';
import type {
  RecommendationItem,
  WeeklyRecommendation,
} from '../recommendation/weekly-recommendation';
import type { StationSummary } from '../station/station';

/** 관제 대시보드 지사 행 */
export interface StationOverview {
  station: StationSummary;
  uploadedThisWeek: number;
  processingCount: number;
  awaitingReviewCount: number;
  failedCount: number;
  lastUploadAt: ISODateString | null;
}

/** 관제 처리 큐 Job 목록 조회 */
export interface JobListQuery extends PageQuery {
  type?: JobType;
  status?: JobStatus;
}

/** 추천 검토 화면 — 항목에 콘텐츠 요약 조인 */
export interface RecommendationReview {
  recommendation: WeeklyRecommendation;
  items: readonly { item: RecommendationItem; content: ContentSummary }[];
}

/** 추천 수정사항 입력 */
export interface RequestRecommendationRevision {
  note: string;
}
