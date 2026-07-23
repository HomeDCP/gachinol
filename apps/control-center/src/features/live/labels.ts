import { LIVE_SESSION_STATUS_TRANSITIONS } from '@gachinol/shared';
import type { LiveSessionStatus, Platform } from '@gachinol/shared';
import type { LiveLifecycleAction } from '../../api/live';

/** 라이브 상태 라벨 (센터 시점) — satisfies Record로 6종 전수 강제 */
export const LIVE_STATUS_LABEL = {
  scheduled: '편성됨',
  preparing: '준비중',
  live: '방송중',
  interrupted: '일시중단',
  ended: '종료됨',
  canceled: '취소됨',
} as const satisfies Record<LiveSessionStatus, string>;

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger';

export const LIVE_STATUS_TONE = {
  scheduled: 'info',
  preparing: 'progress',
  live: 'success',
  interrupted: 'danger',
  ended: 'neutral',
  canceled: 'neutral',
} as const satisfies Record<LiveSessionStatus, StatusTone>;

/** 프롬프터 플랫폼 뱃지 라벨 — SNS 7종 전수 */
export const PLATFORM_LABEL = {
  kakao: '카카오',
  youtube: '유튜브',
  facebook: '페이스북',
  instagram: '인스타',
  x: 'X',
  threads: '스레드',
  app: '앱',
} as const satisfies Record<Platform, string>;

export interface LifecycleActionMeta {
  label: string;
  /** 위험(종결·중단) 액션은 destructive로 렌더 */
  destructive: boolean;
}

/**
 * (from→to) 쌍 → 액션. 어떤 전이가 합법인지는 shared LIVE_SESSION_STATUS_TRANSITIONS가 결정하고
 * (규칙 사본 금지), 여기선 합법 전이에 액션 이름·라벨만 매핑한다.
 */
const PAIR_ACTION: Record<string, LiveLifecycleAction> = {
  'scheduled->preparing': 'prepare',
  'scheduled->canceled': 'cancel',
  'preparing->live': 'start',
  'preparing->canceled': 'cancel',
  'live->interrupted': 'interrupt',
  'live->ended': 'end',
  'interrupted->live': 'resume',
  'interrupted->ended': 'end',
};

export const LIFECYCLE_ACTION_META = {
  prepare: { label: '준비 시작', destructive: false },
  start: { label: '방송 시작', destructive: false },
  interrupt: { label: '일시중단', destructive: true },
  resume: { label: '방송 재개', destructive: false },
  end: { label: '방송 종료', destructive: true },
  cancel: { label: '취소', destructive: true },
} as const satisfies Record<LiveLifecycleAction, LifecycleActionMeta>;

/**
 * 현재 상태에서 가능한 라이프사이클 액션 — shared 전이 맵의 합법 목적지에서 파생.
 * 종결(ended·canceled)은 빈 배열. 순서는 shared 전이 배열 순서를 따른다.
 */
export function availableLifecycleActions(status: LiveSessionStatus): LiveLifecycleAction[] {
  const targets = LIVE_SESSION_STATUS_TRANSITIONS[status] ?? [];
  const actions: LiveLifecycleAction[] = [];
  for (const to of targets) {
    const action = PAIR_ACTION[`${status}->${to}`];
    if (action) actions.push(action);
  }
  return actions;
}
