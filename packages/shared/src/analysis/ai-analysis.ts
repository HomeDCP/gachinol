import type { AiAnalysisId, ContentId } from '../common/id';
import type { ISODateString } from '../common/time';

/**
 * AI 분석 결과. 비전·텍스트 분석은 따로 완료될 수 있어 둘 다 optional
 * (부분 실패 허용 — 하나만 있어도 유효).
 * 재생성 시 기존 행을 덮지 않고 generation 새 행 — 이력 비교 가능.
 */
export interface SttSegment {
  startSec: number;
  endSec: number;
  text: string;
  /** 0~1 */
  confidence?: number;
}

/** 화면(비전) 분석 결과 */
export interface VisionAnalysis {
  /** 샷 경계 검출 (자동편집·하이라이트 근거) */
  shots: readonly { startSec: number; endSec: number; label?: string }[];
  /** 화면 라벨·객체 태그 */
  labels: readonly string[];
  /** 썸네일 후보 프레임 (초) */
  thumbnailCandidatesSec?: readonly number[];
  /** 유해·민감 플래그 (송출 전 검수 참고) */
  safetyFlags?: readonly string[];
}

/** 텍스트(STT·요약) 분석 결과 */
export interface TextAnalysis {
  transcript: readonly SttSegment[];
  summary: string;
  keywords: readonly string[];
  /** Content.tags로 비정규화되는 원본 */
  tags: readonly string[];
  /** 'ko' 등 */
  language?: string;
}

export interface AiAnalysis {
  id: AiAnalysisId;
  contentId: ContentId;
  /** 분석 대상 산출물 세대 — Content.generation과 대응. (contentId, generation) unique */
  generation: number;
  vision?: VisionAnalysis;
  text?: TextAnalysis;
  /** 주간 추천 산정용 점수 (ai-worker 산출, 0~1) */
  recommendationScore?: number;
  modelInfo?: { visionModel?: string; sttModel?: string; version?: string };
  createdAt: ISODateString;
  completedAt?: ISODateString;
}
