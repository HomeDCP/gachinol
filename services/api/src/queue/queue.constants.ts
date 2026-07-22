import type { Queue, QueueEvents } from 'bullmq';

/** DI 토큰 — REDIS_URL 미설정 시 null 바인딩(부팅 유지, 기능만 비활성) */
export const MEDIA_QUEUE = Symbol('MEDIA_QUEUE');
export const MEDIA_QUEUE_EVENTS = Symbol('MEDIA_QUEUE_EVENTS');

export type MediaQueue = Queue | null;
export type MediaQueueEvents = QueueEvents | null;
