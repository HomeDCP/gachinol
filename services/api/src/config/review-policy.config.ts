import type { ProgramCategory, ReviewPolicy } from '@gachinol/shared';

/**
 * reviewPolicy 기본값 — shared §20 미결의 임시 확정 (도메인 오너 확정 시 이 파일만 수정).
 * 정치 대담·커머스는 법적·상거래 리스크로 보수적 기본(센터 게이트).
 */
export const REVIEW_POLICY_DEFAULTS: Record<ProgramCategory, ReviewPolicy> = {
  news: 'reporter_then_center', // 주간뉴스 소재 — 센터 게이트
  emergency: 'reporter_then_center', // 긴급 — 센터 게이트
  politics_talk: 'reporter_then_center', // 정치 대담 — 법적 리스크, 보수적 기본
  live_commerce: 'reporter_then_center', // 커머스 — 상거래 리스크, 보수적 기본
  culture: 'reporter_only',
  local_weather: 'reporter_only',
};
