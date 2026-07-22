import { e2eDb } from './e2e-db';

/** BullMQ는 실 Redis 필수(Lua 스크립트 — ioredis-mock 불가). 미가용 시 스위트 skip(녹색 종료) */
export const redisAvailable = (): boolean => e2eDb().redisAvailable === true;

/** Redis 필요 스위트용: `const d = describeWithRedis(); d('...', () => ...)` */
export const describeWithRedis = (): jest.Describe =>
  redisAvailable() ? describe : describe.skip;
