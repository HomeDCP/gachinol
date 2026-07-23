import type { RecommendationStatus, WeeklyRecommendation } from '@gachinol/shared';
import type { StatusTone } from '../contents/status';

/**
 * 주간 추천 상태 표현 — shared RecommendationStatus 10종 전수를 satisfies로 컴파일 타임 강제.
 * 이번 슬라이스에서 실제 도달 가능한 값은 5종(generating·generation_failed·pending_review·
 * regenerating·approved). revision_requested는 서버 2홉 자동 연쇄라 관측되지 않고,
 * publishing 이후 4종은 송출 배선이 후속이라 미도달 — 그래도 전수 정의해 활성화 시 tsc가 잡게 한다.
 */
export interface RecommendationStatusBadge {
  label: string;
  tone: StatusTone;
  /**
   * 센터의 조치가 필요한 상태 — 정확히 2종 (테스트로 고정):
   * pending_review(승인/수정요청) · generation_failed(재생성 재시도).
   */
  needsCenterAction?: true;
}

export const RECOMMENDATION_BADGE = {
  generating: { label: '생성 중', tone: 'progress' },
  generation_failed: { label: '생성 실패', tone: 'danger', needsCenterAction: true },
  pending_review: { label: '검토 대기', tone: 'warning', needsCenterAction: true },
  revision_requested: { label: '수정 요청됨', tone: 'warning' },
  regenerating: { label: '수정 반영 중', tone: 'progress' },
  approved: { label: '승인됨', tone: 'success' },
  publishing: { label: '송출 중', tone: 'progress' },
  publish_failed: { label: '송출 실패', tone: 'danger' },
  published: { label: '송출 완료', tone: 'success' },
  discarded: { label: '폐기됨', tone: 'neutral' },
} as const satisfies Record<RecommendationStatus, RecommendationStatusBadge>;

/** 상태별 안내 문구 — 상세 화면 상태 카드 (센터 시점) */
export const RECOMMENDATION_DESCRIPTION = {
  generating: '해당 주차의 송출 완료 콘텐츠를 모아 추천을 만들고 있습니다.',
  generation_failed:
    '추천 생성에 실패했습니다. 해당 주차에 대상 콘텐츠가 없었을 수 있습니다 — 다시 생성해 보세요.',
  pending_review: '센터 검토 대기입니다. 승인하거나 수정 요청을 보내세요.',
  revision_requested: '수정 요청이 접수되어 재생성으로 넘어가는 중입니다.',
  regenerating: '수정 요청을 반영해 추천을 다시 만들고 있습니다.',
  approved: '승인이 완료되었습니다. 주간뉴스 편성 소재로 사용하세요. (송출 배선은 후속)',
  publishing: '추천 묶음을 송출하고 있습니다.',
  publish_failed: '추천 송출에 실패했습니다.',
  published: '추천 송출이 완료되었습니다.',
  discarded: '폐기되어 종결되었습니다.',
} as const satisfies Record<RecommendationStatus, string>;

export const recommendationBadge = (s: RecommendationStatus): RecommendationStatusBadge =>
  RECOMMENDATION_BADGE[s];

export interface RecommendationActions {
  /** 승인·수정요청 — pending_review에서만 (서버가 그 상태에서만 CAS 통과) */
  canDecide: boolean;
  /** 재생성 재시도 = POST /v1/recommendations 재호출(generation_failed→generating은 map-legal) */
  canRetryGeneration: boolean;
}

export function recommendationActionsFor(
  r: Pick<WeeklyRecommendation, 'status'>,
): RecommendationActions {
  return {
    canDecide: r.status === 'pending_review',
    canRetryGeneration: r.status === 'generation_failed',
  };
}

/** 서버가 비동기로 진행시키는 상태 — 상세 10s 폴링 대상 (useContentDetail 선례 동형) */
export const AUTO_PROGRESS_RECOMMENDATION_STATUSES: readonly RecommendationStatus[] = [
  'generating',
  'regenerating',
];

export const isAutoProgressRecommendationStatus = (s: RecommendationStatus): boolean =>
  AUTO_PROGRESS_RECOMMENDATION_STATUSES.includes(s);
