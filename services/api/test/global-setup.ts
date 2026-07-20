/**
 * E2E globalSetup — DB 이름 안전장치(개발 DB 보호) → DATABASE_URL 2초 TCP 프로브 →
 * 성공 시 테스트 DB 보장(없으면 생성) + migrate deploy + 시드 → 플래그 파일 기록.
 * 실패 시 경고만 남기고 DB 의존 스위트는 skip (녹색 종료).
 */
import { isSafeTestDbUrl } from './e2e-env';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { FLAG_FILE } from './e2e-db';

const API_ROOT = join(__dirname, '..');

const probeTcp = (url: string, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let host = 'localhost';
    let port = 5432;
    try {
      const u = new URL(url);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
    } catch {
      resolve(false);
      return;
    }
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

/** 테스트 DB가 없으면 같은 서버의 postgres 유지보수 DB로 접속해 생성 (best-effort) */
const ensureDatabase = async (url: string): Promise<void> => {
  const dbName = new URL(url).pathname.replace(/^\//, '');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const prisma = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName.replace(/'/g, "''")}'`,
    );
    if (rows.length === 0) {
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
};

export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL as string;
  const adminEmail = process.env.SEED_ADMIN_EMAIL as string;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD as string;

  // 안전장치 — e2e는 매 스위트 TRUNCATE CASCADE를 실행한다. 개발 DB를 향하면 절대 진행 금지
  if (!isSafeTestDbUrl(databaseUrl)) {
    console.warn(
      "\n[e2e] DATABASE_URL의 DB 이름에 'test'가 없어 거부합니다 — e2e는 DB 전체를 TRUNCATE 합니다." +
        ' 전용 테스트 DB(예: gachinol_test)를 지정하세요. DB 의존 스위트를 건너뜁니다\n',
    );
    writeFileSync(FLAG_FILE, JSON.stringify({ available: false }));
    return;
  }

  const reachable = await probeTcp(databaseUrl, 2000);
  if (!reachable) {
    console.warn('\n[e2e] DATABASE_URL 연결 불가 — DB 의존 스위트를 건너뜁니다\n');
    writeFileSync(FLAG_FILE, JSON.stringify({ available: false }));
    return;
  }

  try {
    // 셋업까지 자동화 — 신규 클론에서 pnpm test:e2e 한 방 (테스트 DB 생성 포함)
    await ensureDatabase(databaseUrl);
    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, stdio: 'inherit' });
    execSync('pnpm exec tsx prisma/seed.ts', { cwd: API_ROOT, stdio: 'inherit' });
    writeFileSync(FLAG_FILE, JSON.stringify({ available: true, adminEmail, adminPassword }));
  } catch (e) {
    console.warn(
      `\n[e2e] DB 준비 실패(migrate/seed) — DB 의존 스위트를 건너뜁니다: ${e instanceof Error ? e.message : e}\n`,
    );
    writeFileSync(FLAG_FILE, JSON.stringify({ available: false }));
  }
}
