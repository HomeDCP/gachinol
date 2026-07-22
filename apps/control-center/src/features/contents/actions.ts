import type { Content } from '@gachinol/shared';
import { ContentStatus, isFailureStatus } from '@gachinol/shared';

/**
 * 센터 결정·재시도 게이팅 — 전이 맵 사본 금지, shared 상태·헬퍼 재사용.
 * 센터는 지사 횡단 권한이라 소유권 비의존.
 */
export interface CenterActions {
  /** 승인/수정요청/반려 — awaiting_center_review에서 셋 다 항상 허용(workflow.ts) */
  canDecide: boolean;
  /** 실패 6종 재시도 (목적지는 CONTENT_RETRY_TARGET) */
  canRetry: boolean;
}

/**
 * canDecide는 awaiting_center_review에서만 — 서버 approve/request-revision/reject가
 * 그 상태에서 requireCenterActor를 강제하고, awaiting_reporter_review는 requireOwnerReporter라
 * 기자 전용 액션은 애초에 canDecide=false로 렌더되지 않는다.
 */
export function centerActionsFor(c: Pick<Content, 'status'>): CenterActions {
  return {
    canDecide: c.status === ContentStatus.AwaitingCenterReview,
    canRetry: isFailureStatus(c.status),
  };
}
