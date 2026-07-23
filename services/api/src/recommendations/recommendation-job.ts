import { JobType, type RecommendationItem } from '@gachinol/shared';

/**
 * BullMQ 주간추천 큐 wire 계약 — api-내부 자체완결(shared 아님).
 *
 * 추천 워커는 api **인프로세스**(analysis/distribution 워커 동형)이므로 생산자↔소비자가
 * 언어·프로세스 경계를 넘지 않는다. shared에서는 JobType.Recommendation·RecommendationItem만 소비.
 *
 * ★ shared JobPayloadMap.recommendation({weekOf, revisionRequestId})와 상이 — 그쪽은 명목 Job-레코드
 *   계약(미영속). 여기는 워커가 행 조회 없이 랭킹하도록 좌표를 패킹한 큐 job.data. 두 계약 병존(사본 아님).
 */

/** 추천 큐 이름 — api Queue/QueueEvents/Worker가 공유 */
export const RECOMMENDATION_QUEUE_NAME = 'recommendation' as const;

/** BullMQ job.name — shared JobType.Recommendation 재사용 */
export const RECOMMENDATION_JOB_NAME = JobType.Recommendation; // 'recommendation'

export interface RecommendationJobData {
  recommendationId: string;
  /** 정규화된 월요일 'YYYY-MM-DD' */
  weekOf: string;
  /** 결과 기록 시 세대 CAS의 기대값 */
  generation: number;
  /** 이 재생성이 반영하는 수정요청 (최초 생성이면 null) */
  revisionRequestId: string | null;
  /**
   * 수정 지시 원문(총평 접두용). 워커를 DB 조회 없이 결정적으로 유지하려고 생산자가 패킹한다
   * — RevisionRequest.message의 사본이 아니라 "이 잡이 반영한 지시"의 스냅샷.
   */
  revisionNote: string | null;
  /**
   * 후보에서 제외할 콘텐츠 — 배선만 완료, v1은 항상 [].
   * ★ note 자연어에 매직 토큰(`[제외:{uuid}]`)을 심지 않는다: note는 사람이 쓰는 필드라
   *   우연한 대괄호와 충돌하고, 정공법(RequestRecommendationRevision 구조 확장)으로 옮길 때 비싸다.
   */
  excludeContentIds: readonly string[];
}

/** 워커→api(job.returnvalue) — 계산 결과만. DB 기록·전이는 전부 api(PipelineService)의 몫 */
export interface RecommendationJobResult {
  items: readonly RecommendationItem[];
  summary: string;
  /** 절단 전 후보 수 (총평·감사용) */
  candidateCount: number;
}

/**
 * 결정적 jobId — (추천행, 세대) 단위 dedup. 재큐는 remove→add.
 * ★ 형식 제약(BullMQ): 콜론 포함 커스텀 jobId는 정확히 3파트(콜론 2개)만 허용 →
 *   `recommendation:{uuid}:g{n}` (uuid에 콜론 없음).
 * weekOf가 아니라 id 기반인 이유: 핸들러가 id로 행을 조회하고, weekOf 정규화와 무관하게 안정적이다.
 */
export const recommendationJobId = (recommendationId: string, generation: number): string =>
  `recommendation:${recommendationId}:g${generation}`;
