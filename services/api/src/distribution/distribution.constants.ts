import type { Queue, QueueEvents, Worker } from 'bullmq';

/**
 * DI 토큰 — REDIS_URL 미설정 시 null 바인딩(부팅 유지, 기능만 비활성).
 * 카카오 목이 배포 기본이라 외부 URL 게이트는 없다(analysis의 AI_WORKER_URL 대응 없음).
 */
export const DISTRIBUTION_QUEUE = Symbol('DISTRIBUTION_QUEUE');
export const DISTRIBUTION_QUEUE_EVENTS = Symbol('DISTRIBUTION_QUEUE_EVENTS');
export const DISTRIBUTION_WORKER = Symbol('DISTRIBUTION_WORKER');

export type DistributionQueue = Queue | null;
export type DistributionQueueEvents = QueueEvents | null;
export type DistributionWorker = Worker | null;
