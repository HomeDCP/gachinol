import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup-app';
import { runSeed } from '../prisma/seed';
import { e2eDb } from './e2e-db';
import { isSafeTestDbUrl } from './e2e-env';

export const createE2eApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, { nodeEnv: 'test' });
  await app.init();
  return app;
};

/** 스위트 간 격리 — TRUNCATE CASCADE 후 시드 재주입. 테스트 DB('test' 포함 이름)에서만 동작 */
export const resetDb = async (): Promise<void> => {
  // 심층 방어 — globalSetup 가드를 우회해도 개발 DB는 절대 TRUNCATE하지 않는다
  if (!isSafeTestDbUrl(process.env.DATABASE_URL ?? '')) {
    throw new Error(
      "[e2e] resetDb 거부 — DATABASE_URL의 DB 이름에 'test'가 없습니다 (개발 DB 보호)",
    );
  }
  const info = e2eDb();
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE chat_messages, live_comments, live_sessions, publications, channel_accounts, media_assets, status_transition_logs, revision_requests, contents, refresh_tokens, users, stations CASCADE',
    );
    await runSeed(prisma, { email: info.adminEmail!, password: info.adminPassword! });
  } finally {
    await prisma.$disconnect();
  }
};
