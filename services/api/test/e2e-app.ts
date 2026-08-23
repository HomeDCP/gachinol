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
      // ★ weekly_recommendations는 맨 앞 — 누락 시 행이 누수돼 week_of unique가 다른 스위트를 깨뜨린다
      //   (revision_requests가 FK로 참조하므로 CASCADE 순서상 앞에 둔다)
      // ★ 대장 #114 — resident_upload_links·resident_uploads 명시 편입.
      //   ⚠️ 이것이 막는 것은 **현재의 누수가 아니다**: `resident_upload_links.station_id`가 stations FK라
      //   `TRUNCATE … stations CASCADE`가 이미 두 테이블을 함께 비운다(실증 2026-08-23 — NOTICE로 확인).
      //   명시하는 이유는 그 CASCADE 경로가 **끊어질 수 있기 때문**이다: FK가 SetNull로 바뀌거나
      //   station_id가 nullable이 되면 그날부터 조용히 잔여가 남고, 그때 원인은 이 파일에 보이지 않는다.
      //   즉 우연한 정합을 의도된 정합으로 바꾸는 한 줄이다.
      'TRUNCATE TABLE weekly_recommendations, chat_messages, live_comments, live_sessions, publications, channel_accounts, media_assets, status_transition_logs, revision_requests, resident_uploads, resident_upload_links, contents, refresh_tokens, users, stations CASCADE',
    );
    await runSeed(prisma, { email: info.adminEmail!, password: info.adminPassword! });
  } finally {
    await prisma.$disconnect();
  }
};
