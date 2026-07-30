import type { ContentStatus, ProcessingState } from '@gachinol/shared';

/**
 * 처리 게이트 표시 로직 — 순수 함수(렌더·네트워크 없음).
 *
 * 게이트는 백엔드가 DCP 파이프라인과 호스트를 공유할 때만 활성이다. 앱은 `holding` 불린만
 * 신뢰하고(정지 여부의 유일한 근거), `reason`·`dcp`는 문구를 다듬는 데만 쓴다.
 */

/** 큐 정지의 영향을 실제로 받는 상태 — 이 상태에서만 대기 안내가 의미 있다. */
export const QUEUE_WAITING_STATUSES: readonly ContentStatus[] = [
  'uploaded', // 트랜스코딩 인큐 직후
  'processing', // 트랜스코딩 진행/대기
  'preview_generating', // 프리뷰 인큐
  'regenerating', // 수정 반영 재생성
];

export const isQueueWaitingStatus = (s: ContentStatus): boolean =>
  QUEUE_WAITING_STATUSES.includes(s);

/** 배너를 띄울지 — 게이트가 켜져 있고 실제로 정지 중일 때만 */
export function shouldShowHoldBanner(state: ProcessingState | undefined): boolean {
  return Boolean(state?.enabled && state.holding);
}

/**
 * 특정 콘텐츠 상세에서 대기 안내를 띄울지.
 * 정지 중이어도 그 콘텐츠가 큐 대기 상태가 아니면(예: 내 확인 대기) 안내가 무의미하다.
 */
export function shouldShowHoldForContent(
  state: ProcessingState | undefined,
  status: ContentStatus,
): boolean {
  return shouldShowHoldBanner(state) && isQueueWaitingStatus(status);
}

export interface HoldBannerContent {
  readonly title: string;
  readonly detail: string;
}

/**
 * 배너 문구. 서버가 준 `message`를 그대로 쓰되(문구의 원천은 서버),
 * 조회 실패(dcp_unreachable)만 앱 쪽 표현으로 보정한다 — 사용자에게 "서버 오류"로 읽히면 안 되기 때문.
 */
export function holdBannerContent(state: ProcessingState): HoldBannerContent {
  if (state.reason === 'dcp_unreachable') {
    return {
      title: '처리 대기 중',
      detail: '영상 처리 서버 상태를 확인하는 중입니다. 확인되면 자동으로 시작됩니다.',
    };
  }
  return { title: '처리 대기 중', detail: state.message };
}

/** 대기 시간 표시 — since 이후 경과. 1분 미만은 표시하지 않는다(깜빡임 방지) */
export function formatHoldElapsed(since: string | null, now: number = Date.now()): string | null {
  if (!since) return null;
  const started = Date.parse(since);
  if (Number.isNaN(started)) return null;
  const minutes = Math.floor((now - started) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분째`;
}

/**
 * 폴링 주기 — 정지 중에는 촘촘히(해제를 빨리 잡아 "시작됐다"를 알린다),
 * 평시에는 느슨하게, 게이트가 없으면 아예 폴링하지 않는다.
 */
export function pollIntervalMs(state: ProcessingState | undefined): number | false {
  if (!state?.enabled) return false;
  return state.holding ? 15_000 : 60_000;
}

/**
 * "이제 시작됩니다" 통지를 울릴지 — 정지(true) → 해제(false) 전이에서만.
 *
 * 앱을 처음 열었을 때(이전 값 없음)나 계속 유휴인 동안 울리면 안 된다.
 * 상태를 분리해 순수하게 판정한다(앱 컨벤션: 훅 대신 순수 함수를 테스트).
 */
export function shouldAnnounceRelease(
  wasHolding: boolean,
  state: ProcessingState | undefined,
): boolean {
  if (!state?.enabled) return false;
  return wasHolding && !state.holding;
}
