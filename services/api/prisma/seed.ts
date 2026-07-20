/**
 * Prisma 시드 — 멱등 upsert (키: station.code / user.email).
 * 관리자 자격은 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env로만 — 누락 시 명확한 에러로 중단(fail-fast).
 * 나머지 10개 지사는 이름 미확정이라 시드하지 않는다 — 지사는 코드가 아니라 데이터(운영에서 API로 행 추가).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';

export interface SeedAdminCredentials {
  email: string;
  password: string;
}

interface StationSeed {
  code: string;
  name: string;
  kind: 'center' | 'branch';
  status: 'operating' | 'dormant' | 'planned';
  region: string;
  sortOrder: number;
  dormantSince?: Date;
}

/** e2e 테스트에서도 재사용 — CLI 실행은 아래 main() */
export async function runSeed(prisma: PrismaClient, admin: SeedAdminCredentials): Promise<void> {
  const now = new Date();
  const stations: StationSeed[] = [
    {
      code: 'center',
      name: '제주방송센터',
      kind: 'center',
      status: 'operating',
      region: '제주특별자치도 제주시',
      sortOrder: 0,
    },
    {
      code: 'aewol',
      name: '애월 마을방송국',
      kind: 'branch',
      status: 'dormant',
      region: '제주시 애월읍',
      sortOrder: 1,
      dormantSince: now,
    },
    {
      code: 'jeju-si',
      name: '제주시 마을방송국',
      kind: 'branch',
      status: 'dormant',
      region: '제주시',
      sortOrder: 2,
      dormantSince: now,
    },
  ];

  for (const s of stations) {
    await prisma.station.upsert({
      where: { code: s.code },
      create: {
        id: uuidv7(),
        code: s.code,
        name: s.name,
        kind: s.kind,
        status: s.status,
        region: s.region,
        sortOrder: s.sortOrder,
        dormantSince: s.dormantSince ?? null,
      },
      // 멱등 갱신 — 상태(status·dormantSince)는 운영 전이 결과 보존을 위해 건드리지 않는다
      update: { name: s.name, region: s.region, sortOrder: s.sortOrder },
    });
  }

  const email = admin.email.trim().toLowerCase();
  const passwordHash = await argon2.hash(admin.password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email },
    create: {
      id: uuidv7(),
      role: 'admin',
      name: '플랫폼 관리자',
      email,
      status: 'active',
      stationId: null, // shared CenterStaffUser: admin 무소속 허용
      passwordHash,
    },
    update: { passwordHash, status: 'active' },
  });
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    // 조용한 부분 성공 금지 — "왜 로그인 안 되지" 디버깅 비용 방지
    throw new Error(
      '시드 실패: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD 환경변수가 필요합니다 (.env 참고).',
    );
  }

  const prisma = new PrismaClient();
  try {
    await runSeed(prisma, { email, password });
    console.log('[seed] 완료 — stations(center·aewol·jeju-si) + admin 계정');
  } finally {
    await prisma.$disconnect();
  }
}

// tsx prisma/seed.ts 직접 실행일 때만 (e2e에서 runSeed import 시 부수효과 금지)
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
