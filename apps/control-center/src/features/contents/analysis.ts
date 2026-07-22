import type { AiAnalysis, TextAnalysis, VisionAnalysis } from '@gachinol/shared';

/**
 * AI 분석 표시 파생 헬퍼 (읽기 전용).
 * vision·text는 각각 optional(부분 실패 허용 — 하나만 있어도 유효).
 */

/** 화면 분석이 존재하는가 */
export function hasVision(a: AiAnalysis | undefined): a is AiAnalysis & { vision: VisionAnalysis } {
  return a?.vision !== undefined;
}

/** 텍스트 분석이 존재하는가 */
export function hasText(a: AiAnalysis | undefined): a is AiAnalysis & { text: TextAnalysis } {
  return a?.text !== undefined;
}

/** 분석 세대가 콘텐츠 현 세대와 불일치 — 재생성 결과 대기 중(stale) */
export function isStaleAnalysis(a: AiAnalysis | undefined, contentGeneration: number): boolean {
  return a !== undefined && a.generation !== contentGeneration;
}

/** 유해·민감 플래그가 있는가 (송출 전 검수 danger 배너 근거) */
export function hasSafetyFlags(a: AiAnalysis | undefined): boolean {
  return (a?.vision?.safetyFlags?.length ?? 0) > 0;
}

/** 주간 추천 점수 → 'NN%' (부재면 null) — 주간추천 백엔드 부재이므로 수치 표시만 */
export function formatRecommendationScore(score?: number): string | null {
  if (score === undefined || !Number.isFinite(score)) return null;
  const clamped = Math.max(0, Math.min(1, score));
  return `${Math.round(clamped * 100)}%`;
}
