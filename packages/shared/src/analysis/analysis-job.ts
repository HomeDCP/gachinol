import type { ContentId, MediaAssetId } from '../common/id';
import type { S3ObjectRef } from '../media/media-job';
import type { TextAnalysis, VisionAnalysis } from './ai-analysis';

/**
 * api ↔ ai-worker HTTP 계약 + 'analysis' BullMQ 큐 wire 계약의 단일 원천.
 *
 * ai-worker(Python/FastAPI)는 DB·큐·토큰을 모른다 — 이 파일의 입출력(AnalyzeRequest/AnalyzeResponse)만 안다.
 * 큐 계약(AnalysisJobData)은 api 인프로세스 생산자 → api 인프로세스 Analysis 워커의 in-band 계약이며,
 * `media/media-job.ts`의 미디어 큐 계약과 동형이다. job.ts의 도메인 Job 유니언은 건드리지 않는다
 * (결합 홉은 transport 관심사 → 여기서 자체완결. granular vision_analysis/stt/ai_summary는 향후 팬아웃 예약값).
 */

/** BullMQ 분석 큐 이름 — api Queue/QueueEvents/Worker가 공유 */
export const ANALYSIS_QUEUE_NAME = 'analysis' as const;
export type AnalysisQueueName = typeof ANALYSIS_QUEUE_NAME;

/** BullMQ job.name — 생산자 add·소비자 process가 공유 */
export const ANALYSIS_JOB_NAME = 'analyze' as const;

// ── HTTP 계약 (POST {AI_WORKER_URL}/analyze) ─────────────────────────────

/** AnalyzeRequest.media — api가 처리 시점에 best-effort presign한 GET URL + 프로브 메타.
 *  스텁 분석기는 url을 무시하고 durationSec 힌트만 쓴다. */
export interface AnalyzeMediaRef {
  /** 원본 presigned GET(짧은 TTL). 실 제공자만 사용, 결정적 스텁은 무시 */
  url?: string;
  mimeType?: string;
  durationSec?: number;
}

/**
 * POST /analyze 요청 본문 (JSON 키 = camelCase). api Analysis 워커가 조립.
 * contentId/generation은 wire 경계이므로 brand 없는 plain string/number.
 */
export interface AnalyzeRequest {
  contentId: string;
  generation: number;
  media?: AnalyzeMediaRef;
  languageHint?: 'ko' | null;
  /** 미지정 시 vision·text 둘 다 true */
  options?: { vision?: boolean; text?: boolean };
}

/**
 * POST /analyze 응답 = AiAnalysis에서 서버소유 필드(id·contentId·generation·createdAt·completedAt) 제외.
 * vision/text는 shared VisionAnalysis/TextAnalysis를 **그대로 재사용**(재정의 금지).
 * id/contentId/generation/시각은 api가 유일 DB 기록자로서 upsert 시 부여.
 */
export interface AnalyzeResponse {
  vision?: VisionAnalysis;
  text?: TextAnalysis;
  /** 주간 추천 산정용 0~1 */
  recommendationScore?: number;
  modelInfo?: { visionModel?: string; sttModel?: string; version?: string };
}

// ── 'analysis' 큐 wire 계약 (api 생산자 → api 인프로세스 Analysis 워커) ──────

/** 분석 잡 도메인 페이로드 — job.ts JobPayloadMap을 건드리지 않고 여기서 자체완결 */
export interface AnalysisJobPayload {
  contentId: ContentId;
  generation: number;
  /** 분석 원본(= original 자산) */
  assetId: MediaAssetId;
  languageHint: 'ko' | null;
}

/**
 * BullMQ 잡의 data 계약 (job.name = ANALYSIS_JOB_NAME, job.data = AnalysisJobData).
 * MediaJobData 동형 — 인프로세스 워커가 source 좌표로 처리 시점 presign GET을 발급해
 * AnalyzeRequest.media.url에 실어 ai-worker로 POST한다(DOWNLOAD_URL_TTL 만료 위험 제거).
 */
export interface AnalysisJobData {
  payload: AnalysisJobPayload;
  /** enqueue 시점 Content.generation (분석 세대 정합) */
  generation: number;
  /** 읽을 원본 좌표 (항상 original 자산). S3ObjectRef는 media-job.ts에서 재사용(재정의 금지) */
  source: S3ObjectRef;
  /**
   * 트랜스코딩이 프로브한 실측 재생시간(초). 인큐 시 산출물 자산에서 조회해 실는다.
   * 워커가 AnalyzeRequest.media.durationSec로 그대로 전달 — 스텁 분석기의 샷 경계·요약이 이 힌트에서 파생되므로
   * 누락 시 모든 콘텐츠가 '약 0초·단일 [0,0] 샷' 퇴화 분석으로 떨어진다. 미측정 시 생략(undefined).
   */
  durationSec?: number;
}

/** job.returnvalue (Analysis 워커 → api QueueEvents completed 소비자). AnalyzeResponse 그대로. */
export type AnalysisJobResult = AnalyzeResponse;

/** 결정적 jobId — 동일 (contentId, generation)의 중복 인큐 dedup. api·워커·테스트 공유 */
export const analysisJobId = (contentId: string, generation: number): string =>
  `analysis:${contentId}:g${generation}`;
