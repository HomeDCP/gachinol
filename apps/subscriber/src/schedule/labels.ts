/**
 * 편성표 표시 라벨 — `satisfies Record<SlotKind, …>`로 전수 강제(슬롯 종류가 늘면 tsc가 잡는다).
 * `features/feed/labels.ts`와 동일한 규율.
 */
import type { BadgeToneName } from '@gachinol/ui';
import type { SlotKind } from './schedule-data';

/** 시청자에게 보이는 종류 표시 — 기술 용어(VOD·라이브) 대신 생활어(03 §A 어르신 접근성) */
export const SLOT_KIND_LABEL = {
  live: '생방송',
  vod: '새 영상',
  emergency: '긴급',
} as const satisfies Record<SlotKind, string>;

/** 뱃지 색 — 생방송=빨강(라이브 탭 `statusLive`와 같은 뜻), 새 영상=파랑, 긴급=주황 */
export const SLOT_KIND_TONE = {
  live: 'danger',
  vod: 'info',
  emergency: 'warning',
} as const satisfies Record<SlotKind, BadgeToneName>;
