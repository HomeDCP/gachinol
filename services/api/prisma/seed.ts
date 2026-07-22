/**
 * Prisma 시드 — 멱등 upsert (키: station.code / user.email).
 * 관리자 자격은 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env로만 — 누락 시 명확한 에러로 중단(fail-fast).
 * 나머지 10개 지사는 이름 미확정이라 시드하지 않는다 — 지사는 코드가 아니라 데이터(운영에서 API로 행 추가).
 */
import { Prisma, PrismaClient } from '@prisma/client';
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

/**
 * 구독자 앱 데모용 published 콘텐츠 시드 — runSeed와 분리(★ 회귀 안전 핵심).
 * resetDb는 runSeed만 호출하므로 기존 e2e 스위트는 이 행들을 절대 보지 않는다(구성적 무회귀).
 * feed e2e만 resetDb 후 이 함수를 명시 호출해 자기 픽스처를 제어.
 *
 * 멱등: 고정 UUID v7 상수 + upsert(content=id / media_asset=(bucket,storageKey) / analysis=(contentId,generation)).
 * 정직성: 실제 오브젝트 바이트는 dev 스토리지에 부재 — 서명 URL '발급'·투영은 동작하나
 *         실 썸네일/재생은 media-worker 파이프라인 1회 실행 후. e2e는 서명 발급+투영 정확성만 단언.
 */
interface FeedDemoScene {
  id: string;
  order: number;
  caption: string;
  startSec: number | null;
  endSec: number | null;
}
interface FeedDemoContent {
  id: string;
  stationCode: 'aewol' | 'jeju-si';
  title: string;
  category: string;
  cultureTopics: string[];
  durationSec: number;
  /** 스태거드 — 커서 정렬(publishedAt DESC) 검증용 */
  publishedAt: string;
  summary: string;
  keywords: string[];
  tags: string[];
  scenes: FeedDemoScene[];
  renditionAssetId: string;
  thumbnailAssetId: string;
  analysisId: string;
}

const FEED_DEMO_CONTENTS: FeedDemoContent[] = [
  {
    id: '01920000-0000-7000-8000-0000000000a1',
    stationCode: 'aewol',
    title: '애월 해녀의 하루 — 물질 현장 동행',
    category: 'news',
    cultureTopics: [],
    durationSec: 185,
    publishedAt: '2026-07-20T09:00:00.000Z',
    summary: '애월 해녀들의 물질 현장을 동행 취재했다. 물때·채취물·공동체 이야기.',
    keywords: ['해녀', '애월', '물질'],
    tags: ['해녀', '애월'],
    scenes: [
      { id: '01920000-0000-7000-8000-0000000000b1', order: 0, caption: '오프닝 — 애월 포구', startSec: 0, endSec: 6 },
      { id: '01920000-0000-7000-8000-0000000000b2', order: 1, caption: '물질 현장', startSec: 6, endSec: 95 },
      { id: '01920000-0000-7000-8000-0000000000b3', order: 2, caption: '클로징 (타이밍 미정)', startSec: null, endSec: null },
    ],
    renditionAssetId: '01920000-0000-7000-8000-0000000000d1',
    thumbnailAssetId: '01920000-0000-7000-8000-0000000000e1',
    analysisId: '01920000-0000-7000-8000-0000000000f1',
  },
  {
    id: '01920000-0000-7000-8000-0000000000a2',
    stationCode: 'aewol',
    title: '애월 오일장 먹거리 탐방',
    category: 'culture',
    cultureTopics: ['food', 'producer'],
    durationSec: 240,
    publishedAt: '2026-07-19T09:00:00.000Z',
    summary: '애월 오일장의 제철 먹거리와 생산자들을 소개한다.',
    keywords: ['오일장', '먹거리', '생산자'],
    tags: ['오일장', '먹거리'],
    scenes: [
      { id: '01920000-0000-7000-8000-0000000000b4', order: 0, caption: '오일장 입구', startSec: 0, endSec: 8 },
      { id: '01920000-0000-7000-8000-0000000000b5', order: 1, caption: '제철 먹거리', startSec: 8, endSec: 120 },
    ],
    renditionAssetId: '01920000-0000-7000-8000-0000000000d2',
    thumbnailAssetId: '01920000-0000-7000-8000-0000000000e2',
    analysisId: '01920000-0000-7000-8000-0000000000f2',
  },
  {
    id: '01920000-0000-7000-8000-0000000000c1',
    stationCode: 'jeju-si',
    title: '제주시 촌장의 내일 날씨 — "밭일 하기 좋은 날"',
    category: 'local_weather',
    cultureTopics: [],
    durationSec: 95,
    publishedAt: '2026-07-18T09:00:00.000Z',
    summary: '오래 산 촌장의 감으로 짚어보는 내일 제주시 날씨와 추천 활동.',
    keywords: ['날씨', '촌장', '제주시'],
    tags: ['날씨'],
    scenes: [
      { id: '01920000-0000-7000-8000-0000000000b6', order: 0, caption: '촌장 인사', startSec: 0, endSec: 10 },
      { id: '01920000-0000-7000-8000-0000000000b7', order: 1, caption: '내일 날씨 짚기', startSec: 10, endSec: 80 },
    ],
    renditionAssetId: '01920000-0000-7000-8000-0000000000d3',
    thumbnailAssetId: '01920000-0000-7000-8000-0000000000e3',
    analysisId: '01920000-0000-7000-8000-0000000000f3',
  },
];

export async function seedFeedDemo(prisma: PrismaClient): Promise<void> {
  const bucket = process.env.S3_BUCKET ?? 'gachinol-media';
  const now = new Date();
  const dummyChecksum = 'a'.repeat(64); // 실 바이트 부재 — 형태만 유효한 64-hex

  for (const c of FEED_DEMO_CONTENTS) {
    const station = await prisma.station.findUnique({ where: { code: c.stationCode } });
    if (!station) {
      throw new Error(`seedFeedDemo: 지사(${c.stationCode}) 부재 — runSeed 선행 필요`);
    }

    const scenesJson = c.scenes as unknown as Prisma.InputJsonValue;
    await prisma.content.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        stationId: station.id,
        origin: 'live_vod', // 합성 시드 — reporterId=null 불변식 충족(user 시드 불요)
        reporterId: null,
        title: c.title,
        category: c.category,
        cultureTopics: c.cultureTopics,
        status: 'published',
        priority: 'normal',
        reviewPolicy: 'reporter_only',
        generation: 1,
        scenes: scenesJson,
        targetChannelAccountIds: [],
        tags: c.tags,
        durationSec: c.durationSec,
        publishedAt: new Date(c.publishedAt),
      },
      update: {
        stationId: station.id,
        title: c.title,
        category: c.category,
        cultureTopics: c.cultureTopics,
        status: 'published',
        scenes: scenesJson,
        tags: c.tags,
        durationSec: c.durationSec,
        publishedAt: new Date(c.publishedAt),
      },
    });

    const renditionKey = `contents/${c.id}/g1/rendition_720p.mp4`;
    await prisma.mediaAsset.upsert({
      where: { bucket_storageKey: { bucket, storageKey: renditionKey } },
      create: {
        id: c.renditionAssetId,
        ownerKind: 'content',
        contentId: c.id,
        kind: 'rendition',
        status: 'ready',
        generation: 1,
        bucket,
        storageKey: renditionKey,
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSec: c.durationSec,
        renditionLabel: '720p',
        checksumSha256: dummyChecksum,
      },
      update: { status: 'ready', durationSec: c.durationSec },
    });

    const thumbnailKey = `contents/${c.id}/g1/thumbnail.jpg`;
    await prisma.mediaAsset.upsert({
      where: { bucket_storageKey: { bucket, storageKey: thumbnailKey } },
      create: {
        id: c.thumbnailAssetId,
        ownerKind: 'content',
        contentId: c.id,
        kind: 'thumbnail',
        status: 'ready',
        generation: 1,
        bucket,
        storageKey: thumbnailKey,
        mimeType: 'image/jpeg',
        width: 1280,
        height: 720,
        checksumSha256: dummyChecksum,
      },
      update: { status: 'ready' },
    });

    const textJson = {
      transcript: [],
      summary: c.summary,
      keywords: c.keywords,
      tags: c.tags,
    } as unknown as Prisma.InputJsonValue;
    await prisma.aiAnalysis.upsert({
      where: { contentId_generation: { contentId: c.id, generation: 1 } },
      create: {
        id: c.analysisId,
        contentId: c.id,
        generation: 1,
        text: textJson,
        completedAt: now,
      },
      update: { text: textJson, completedAt: now },
    });
  }
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
    await seedFeedDemo(prisma);
    console.log(
      '[seed] 완료 — stations(center·aewol·jeju-si) + admin 계정 + 구독자 데모 published 콘텐츠 3건',
    );
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
