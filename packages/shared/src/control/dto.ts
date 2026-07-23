import type { PageQuery } from '../common/pagination';
import type { ISODateOnlyString, ISODateString } from '../common/time';
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

/**
 * 주간 추천 생성 트리거 — 주중 아무 날짜나 보내면 서버가 그 주 월요일(Asia/Seoul)로 정규화한다.
 * weekOf는 주 1건 unique 키라 같은 주차 재요청은 멱등 분기(재시도 200 / 진행중·기존 409).
 */
export interface GenerateRecommendationRequest {
  weekOf: ISODateOnlyString;
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
