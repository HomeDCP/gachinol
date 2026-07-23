import type { Queue, QueueEvents, Worker } from 'bullmq';

/**
 * DI 토큰 — 게이트는 **REDIS_URL 단독**(추천 계산은 순수 로컬 DB 집계라 외부 URL 불요).
 * 미설정 시 null 바인딩 → producer가 인라인 폴백으로 같은 결과에 도달한다(부팅 유지).
 */
export const RECOMMENDATION_QUEUE = Symbol('RECOMMENDATION_QUEUE');
export const RECOMMENDATION_QUEUE_EVENTS = Symbol('RECOMMENDATION_QUEUE_EVENTS');
export const RECOMMENDATION_WORKER = Symbol('RECOMMENDATION_WORKER');

export type RecommendationQueue = Queue | null;
export type RecommendationQueueEvents = QueueEvents | null;
export type RecommendationWorker = Worker | null;
