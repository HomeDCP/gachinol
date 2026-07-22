import type { Queue, QueueEvents, Worker } from 'bullmq';

/**
 * DI 토큰 — REDIS_URL && AI_WORKER_URL 둘 다 설정돼야 실 인스턴스, 아니면 null 바인딩
 * (부팅 유지·transcode-completed가 preview_generating 직행으로 폴백).
 */
export const ANALYSIS_QUEUE = Symbol('ANALYSIS_QUEUE');
export const ANALYSIS_QUEUE_EVENTS = Symbol('ANALYSIS_QUEUE_EVENTS');
export const ANALYSIS_WORKER = Symbol('ANALYSIS_WORKER');

export type AnalysisQueue = Queue | null;
export type AnalysisQueueEvents = QueueEvents | null;
export type AnalysisWorker = Worker | null;
